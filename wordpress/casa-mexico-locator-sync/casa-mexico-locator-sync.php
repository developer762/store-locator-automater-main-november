<?php
/**
 * Plugin Name: Casa Mexico Store Locator Sync
 * Description: Caches the Casa Mexico Google Sheets locator feed and exposes it to the front end.
 * Version: 1.1.0
 * Author: Casa Mexico
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

const CMX_LOCATOR_OPTION = 'cmx_locator_sync_options';
const CMX_LOCATOR_CRON = 'cmx_locator_sync_cron';
const CMX_LOCATOR_FILENAME = 'casa-mexico-locations.json';

register_activation_hook(__FILE__, 'cmx_locator_activate');
register_deactivation_hook(__FILE__, 'cmx_locator_deactivate');

add_filter('cron_schedules', 'cmx_locator_cron_schedules');
add_action(CMX_LOCATOR_CRON, 'cmx_locator_sync');
add_action('admin_menu', 'cmx_locator_admin_menu');
add_action('admin_init', 'cmx_locator_register_settings');
add_action('admin_init', 'cmx_locator_ensure_scheduled');
add_action('init', 'cmx_locator_ensure_scheduled');
add_action('rest_api_init', 'cmx_locator_register_rest_routes');
add_action('admin_post_cmx_locator_save_and_sync', 'cmx_locator_save_and_sync');
add_action('admin_post_cmx_locator_sync_now', 'cmx_locator_save_and_sync');
add_action('wp_enqueue_scripts', 'cmx_locator_enqueue_config');
add_shortcode('casa_mexico_locator', 'cmx_locator_shortcode');

function cmx_locator_defaults()
{
    return array(
        'endpoint' => 'https://script.google.com/macros/s/AKfycbz8pQv5oekeeTT35zyE22mPqczBBeWI6facsR9vs62jUCzv-kC4eiDxKyYf43nvx9Faew/exec',
        'minimum_locations' => 50,
        'last_sync_at' => '',
        'last_count' => 0,
        'last_error' => '',
    );
}

function cmx_locator_options()
{
    wp_cache_delete(CMX_LOCATOR_OPTION, 'options');
    return wp_parse_args(get_option(CMX_LOCATOR_OPTION, array()), cmx_locator_defaults());
}

function cmx_locator_ensure_scheduled()
{
    if (!wp_next_scheduled(CMX_LOCATOR_CRON)) {
        wp_schedule_event(time() + 60, 'cmx_fifteen_minutes', CMX_LOCATOR_CRON);
    }
}

function cmx_locator_activate()
{
    cmx_locator_ensure_scheduled();
    cmx_locator_sync();
}

function cmx_locator_deactivate()
{
    wp_clear_scheduled_hook(CMX_LOCATOR_CRON);
}

function cmx_locator_cron_schedules($schedules)
{
    $schedules['cmx_fifteen_minutes'] = array(
        'interval' => 15 * MINUTE_IN_SECONDS,
        'display' => __('Every 15 minutes', 'cmx-locator'),
    );
    return $schedules;
}

function cmx_locator_sync()
{
    $options = cmx_locator_options();
    $endpoint = trim($options['endpoint']);
    if (!$endpoint) {
        return cmx_locator_record_error('The Apps Script endpoint is not configured.');
    }

    $sync_url = add_query_arg(array(
        'nocache' => '1',
        'fresh' => '1',
        '_t' => time(),
    ), $endpoint);

    $response = wp_remote_get($sync_url, array(
        'timeout' => 45,
        'redirection' => 10,
        'sslverify' => false,
        'user-agent' => 'WordPress/CasaMexicoLocatorSync-1.1.0; ' . get_bloginfo('url'),
        'headers' => array(
            'Accept' => 'application/json',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
        ),
    ));
    if (is_wp_error($response)) {
        return cmx_locator_record_error($response->get_error_message());
    }

    $status = wp_remote_retrieve_response_code($response);
    if ($status !== 200) {
        return cmx_locator_record_error('Feed returned HTTP ' . $status . ' from Apps Script endpoint.');
    }

    $body = wp_remote_retrieve_body($response);
    $payload = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($payload)) {
        return cmx_locator_record_error('Feed response is not valid JSON.');
    }

    $payload['locations'] = array_values(array_filter($payload['locations'], function ($loc) {
        $tab = isset($loc['tabName']) ? strtolower((string) $loc['tabName']) : '';
        return strpos($tab, 'november') !== false && strpos($tab, '2026') !== false;
    }));

    $validated = cmx_locator_validate_payload($payload, (int) $options['minimum_locations']);
    if (is_wp_error($validated)) {
        return cmx_locator_record_error($validated->get_error_message());
    }

    $upload = wp_upload_dir();
    if (!empty($upload['error'])) {
        return cmx_locator_record_error($upload['error']);
    }

    $path = trailingslashit($upload['basedir']) . CMX_LOCATOR_FILENAME;
    $backup = $path . '.bak';
    $temporary = $path . '.tmp';

    $payload['locations'] = $validated;
    $payload['count'] = count($validated);

    $json = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($temporary, $json, LOCK_EX) === false) {
        return cmx_locator_record_error('Could not write the temporary locator feed.');
    }

    if (file_exists($path) && !copy($path, $backup)) {
        @unlink($temporary);
        return cmx_locator_record_error('Could not back up the previous locator feed.');
    }
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        return cmx_locator_record_error('Could not replace the cached locator feed.');
    }

    $options['last_sync_at'] = gmdate('c');
    $options['last_count'] = count($validated);
    $options['last_error'] = '';
    update_option(CMX_LOCATOR_OPTION, $options);
    do_action('cmx_locator_sync_complete', $payload, $path);

    return count($validated);
}

function cmx_locator_validate_payload($payload, $minimum)
{
    if (!is_array($payload) || !empty($payload['error']) || !isset($payload['locations']) || !is_array($payload['locations'])) {
        return new WP_Error('invalid_payload', 'The endpoint did not return a valid locator payload.');
    }

    $valid_locations = array();
    foreach ($payload['locations'] as $index => $location) {
        if (!is_array($location) || empty($location['name'])) {
            continue;
        }
        $lat_raw = isset($location['latitude']) ? $location['latitude'] : 0;
        $lng_raw = isset($location['longitude']) ? $location['longitude'] : 0;
        $latitude = filter_var($lat_raw, FILTER_VALIDATE_FLOAT);
        $longitude = filter_var($lng_raw, FILTER_VALIDATE_FLOAT);

        if ($latitude === false || $longitude === false || $latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            continue;
        }
        $valid_locations[] = $location;
    }

    if (count($valid_locations) < max(1, $minimum)) {
        return new WP_Error('below_floor', sprintf('The feed contained only %d valid locations (fewer than required minimum of %d). Existing map preserved.', count($valid_locations), max(1, $minimum)));
    }

    return $valid_locations;
}

function cmx_locator_record_error($message)
{
    $options = cmx_locator_options();
    $options['last_error'] = sanitize_text_field($message);
    update_option(CMX_LOCATOR_OPTION, $options);
    error_log('Casa Mexico locator sync: ' . $message);
    return new WP_Error('cmx_locator_sync_failed', $message);
}

function cmx_locator_feed_url()
{
    $upload = wp_upload_dir();
    return trailingslashit($upload['baseurl']) . CMX_LOCATOR_FILENAME;
}

function cmx_locator_feed_path()
{
    $upload = wp_upload_dir();
    return trailingslashit($upload['basedir']) . CMX_LOCATOR_FILENAME;
}

function cmx_locator_register_rest_routes()
{
    register_rest_route('cmx-locator/v1', '/feed', array(
        'methods' => 'GET',
        'callback' => 'cmx_locator_rest_get_feed',
        'permission_callback' => '__return_true',
    ));

    register_rest_route('cmx-locator/v1', '/sync', array(
        'methods' => array('GET', 'POST'),
        'callback' => 'cmx_locator_rest_trigger_sync',
        'permission_callback' => 'cmx_locator_rest_sync_permissions',
    ));
}

function cmx_locator_rest_get_feed()
{
    $path = cmx_locator_feed_path();
    if (!file_exists($path)) {
        cmx_locator_sync();
    }
    if (file_exists($path)) {
        $content = file_get_contents($path);
        $data = json_decode($content, true);
        if ($data) {
            return rest_ensure_response($data);
        }
    }
    return new WP_Error('no_feed', 'Locator feed JSON file not found.', array('status' => 404));
}

function cmx_locator_rest_sync_permissions($request)
{
    if (current_user_can('manage_options')) {
        return true;
    }
    $options = cmx_locator_options();
    $token_param = $request->get_param('token');
    if (!empty($token_param) && !empty($options['endpoint']) && strpos($options['endpoint'], $token_param) !== false) {
        return true;
    }
    return new WP_Error('rest_forbidden', 'Unauthorized sync request.', array('status' => 401));
}

function cmx_locator_rest_trigger_sync($request)
{
    $result = cmx_locator_sync();
    if (is_wp_error($result)) {
        return new WP_Error('sync_failed', $result->get_error_message(), array('status' => 500));
    }
    return rest_ensure_response(array(
        'success' => true,
        'message' => 'Locator feed synchronized successfully.',
        'count' => $result,
    ));
}

function cmx_locator_enqueue_config()
{
    $options = cmx_locator_options();
    $path = cmx_locator_feed_path();
    if (!file_exists($path)) {
        cmx_locator_sync();
        $options = cmx_locator_options();
    }

    $default_endpoint = 'https://script.google.com/macros/s/AKfycbz8pQv5oekeeTT35zyE22mPqczBBeWI6facsR9vs62jUCzv-kC4eiDxKyYf43nvx9Faew/exec';
    $direct_endpoint = !empty($options['endpoint']) ? $options['endpoint'] : $default_endpoint;

    wp_enqueue_script(
        'cmx-locator-feed',
        plugins_url('assets/locator-feed.js', __FILE__),
        array(),
        '1.1.1',
        true
    );
    wp_localize_script('cmx-locator-feed', 'CMX_LOCATOR', array(
        'url' => add_query_arg('v', rawurlencode((string) $options['last_sync_at']), cmx_locator_feed_url()),
        'restUrl' => esc_url_raw(rest_url('cmx-locator/v1/feed')),
        'directEndpoint' => esc_url_raw($direct_endpoint),
        'updatedAt' => $options['last_sync_at'],
        'count' => (int) $options['last_count'],
    ));
}

function cmx_locator_enqueue_shortcode_assets()
{
    cmx_locator_enqueue_config();

    wp_enqueue_style(
        'font-awesome-6',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
        array(),
        '6.5.1'
    );

    wp_enqueue_style(
        'leaflet',
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
        array(),
        '1.9.4'
    );

    wp_enqueue_script(
        'leaflet',
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
        array(),
        '1.9.4',
        true
    );

    wp_enqueue_style(
        'cmx-locator-map',
        plugins_url('assets/locator-map.css', __FILE__),
        array('leaflet', 'font-awesome-6'),
        filemtime(plugin_dir_path(__FILE__) . 'assets/locator-map.css')
    );

    wp_enqueue_script(
        'cmx-locator-map',
        plugins_url('assets/locator-map.js', __FILE__),
        array('leaflet', 'cmx-locator-feed'),
        filemtime(plugin_dir_path(__FILE__) . 'assets/locator-map.js'),
        true
    );
}

function cmx_locator_shortcode($atts = array())
{
    cmx_locator_enqueue_shortcode_assets();

    ob_start();
    ?>
    <div class="cmx-locator-wrap">
        <!-- Header Row with Title and View Tabs flexed side-by-side -->
        <div class="cmx-header-row">
            <h2 class="cmx-page-title">Casa Mexico Plugin</h2>
            <div class="cmx-view-toggle">
                <button type="button" id="cmx-view-map-btn" class="cmx-toggle-btn cmx-active" title="Map View"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Store Locator</button>
                <button type="button" id="cmx-view-sales-btn" class="cmx-toggle-btn" title="Sales Data Analytics"><i class="fa-solid fa-chart-column" aria-hidden="true"></i> Sales Data</button>
                <button type="button" id="cmx-view-table-btn" class="cmx-toggle-btn" title="Data Grid Table"><i class="fa-solid fa-table-list" aria-hidden="true"></i> Data Table</button>
            </div>
        </div>

        <div id="cmx-split-view" class="cmx-locator-body">
            <!-- Left Sidebar Controls & Store Directory List -->
            <div class="cmx-sidebar">
                <div class="cmx-sidebar-header">
                    <div class="cmx-search-box">
                        <i class="fa-solid fa-magnifying-glass cmx-search-icon" aria-hidden="true"></i>
                        <input type="text" id="cmx-search-input" class="cmx-search-input" placeholder="Search by name, city, state or zip...">
                    </div>
                    
                    <button type="button" id="cmx-use-location-btn" class="cmx-btn-location"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i> USE MY LOCATION</button>
                    
                    <div class="cmx-type-pills" role="group" aria-label="Premise type filters">
                        <button type="button" class="cmx-type-pill active" data-type="">ALL</button>
                        <button type="button" class="cmx-type-pill" data-type="retail">RETAIL</button>
                        <button type="button" class="cmx-type-pill" data-type="bar-restaurant">BAR &amp; RESTAURANT</button>
                    </div>

                    <div class="cmx-filter-dropdowns">
                        <select id="cmx-tab-select" class="cmx-select cmx-select-tab">
                            <option value="">All Sheet Tabs</option>
                        </select>
                        <select id="cmx-state-select" class="cmx-select cmx-select-state">
                            <option value="">All States</option>
                        </select>
                        <select id="cmx-sort-select" class="cmx-select cmx-select-sort">
                            <option value="name-asc">Sort: Name (A-Z)</option>
                            <option value="name-desc">Sort: Name (Z-A)</option>
                            <option value="cases-desc">Sort: Cases (High to Low)</option>
                            <option value="city-asc">Sort: City (A-Z)</option>
                        </select>
                    </div>

                    <div id="cmx-nearest-banner" class="cmx-nearest-banner" style="display: none;"></div>

                    <div id="cmx-count-badge" class="cmx-count-badge">SHOWING 0 OF 0 STORES</div>
                </div>

                <div id="cmx-sidebar-list" class="cmx-sidebar-list">
                    <div class="cmx-no-results">Loading Casa Mexico locations...</div>
                </div>
            </div>

            <!-- Right Side Interactive Leaflet Map -->
            <div class="cmx-map-container">
                <div id="cmx-map-canvas"></div>
            </div>
        </div>

        <!-- Sales Metrics Analytical View -->
        <div id="cmx-sales-view" class="cmx-sales-wrap" style="display: none;">
            <div class="cmx-sales-metrics">
                <div class="cmx-metric-card">
                    <div class="cmx-metric-label">Total Volume</div>
                    <div class="cmx-metric-value" id="cmx-sales-vol">-</div>
                    <div class="cmx-metric-sub">Cases across all territories</div>
                </div>
                <div class="cmx-metric-card">
                    <div class="cmx-metric-label">Top Product</div>
                    <div class="cmx-metric-value" id="cmx-sales-top-prod">-</div>
                    <div class="cmx-metric-sub">Highest volume bottling</div>
                </div>
                <div class="cmx-metric-card">
                    <div class="cmx-metric-label">Active Markets</div>
                    <div class="cmx-metric-value" id="cmx-sales-markets">-</div>
                    <div class="cmx-metric-sub">States &amp; regional territories</div>
                </div>
            </div>
            <div id="cmx-sales-breakdown" class="cmx-sales-grid"></div>
        </div>

        <!-- Tabular Data View -->
        <div id="cmx-table-view" class="cmx-table-wrap" style="display: none;">
            <table class="cmx-data-table">
                <thead>
                    <tr>
                        <th>Store / Retailer Name</th>
                        <th>Address</th>
                        <th>City / State</th>
                        <th>Type</th>
                        <th>Products Stocked</th>
                        <th>Cases</th>
                        <th>Sheet Tab</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="cmx-table-body">
                    <tr><td colspan="8" class="cmx-no-results">Loading data table...</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    <?php
    return ob_get_clean();
}

function cmx_locator_admin_menu()
{
    add_options_page(
        'Casa Mexico Locator',
        'Casa Mexico Locator',
        'manage_options',
        'cmx-locator-sync',
        'cmx_locator_settings_page'
    );
}

function cmx_locator_register_settings()
{
    register_setting('cmx_locator_sync', CMX_LOCATOR_OPTION, array(
        'sanitize_callback' => 'cmx_locator_sanitize_options',
    ));
}

function cmx_locator_sanitize_options($input)
{
    $current = cmx_locator_options();
    $current['endpoint'] = isset($input['endpoint']) ? esc_url_raw(trim($input['endpoint'])) : '';
    $current['minimum_locations'] = isset($input['minimum_locations']) ? max(1, absint($input['minimum_locations'])) : 50;
    return $current;
}

function cmx_locator_save_and_sync()
{
    if (!current_user_can('manage_options')) {
        wp_die('You do not have permission to sync the locator.');
    }
    check_admin_referer('cmx_locator_save_and_sync');

    $options = cmx_locator_options();
    if (isset($_POST['endpoint'])) {
        $options['endpoint'] = esc_url_raw(trim($_POST['endpoint']));
    }
    if (isset($_POST['minimum_locations'])) {
        $options['minimum_locations'] = max(1, absint($_POST['minimum_locations']));
    }
    update_option(CMX_LOCATOR_OPTION, $options);
    wp_cache_delete(CMX_LOCATOR_OPTION, 'options');

    $result = cmx_locator_sync();
    $status = is_wp_error($result) ? 'error' : 'success';
    $count = is_wp_error($result) ? 0 : (int)$result;
    wp_safe_redirect(add_query_arg(array('cmx_sync' => $status, 'cmx_count' => $count), admin_url('options-general.php?page=cmx-locator-sync')));
    exit;
}

function cmx_locator_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $options = cmx_locator_options();
    $next_cron = wp_next_scheduled(CMX_LOCATOR_CRON);
    $logo_url = plugins_url('assets/logo-casa-mexico.svg', __FILE__);
    ?>
    <div class="wrap">
        <h1 style="display: flex; align-items: center; gap: 12px;">
            <div style="background: #ffffff; padding: 4px 8px; border-radius: 8px; display: inline-flex; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <img src="<?php echo esc_url($logo_url); ?>" alt="Casa Mexico" style="height: 32px; width: auto; vertical-align: middle;">
            </div>
            <span>Casa Mexico Store Locator Sync</span>
        </h1>
        <?php if (isset($_GET['cmx_sync'])) : ?>
            <div class="notice notice-<?php echo $_GET['cmx_sync'] === 'success' ? 'success' : 'error'; ?> is-dismissible"><p>
                <?php echo $_GET['cmx_sync'] === 'success' ? sprintf('Locator sync completed successfully! (%d stores published)', $published_count) : 'Sync failed: ' . esc_html(!empty($options['last_error']) ? $options['last_error'] : 'Could not fetch Apps Script payload. Please ensure Web App deployment access is set to "Anyone".'); ?>
            </p></div>
        <?php endif; ?>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="cmx_locator_save_and_sync">
            <?php wp_nonce_field('cmx_locator_save_and_sync'); ?>
            
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="cmx-endpoint">Apps Script Web App Endpoint</label></th>
                    <td>
                        <input id="cmx-endpoint" class="large-text" type="url" name="endpoint" value="<?php echo esc_attr($options['endpoint']); ?>" placeholder="https://script.google.com/macros/s/.../exec" required>
                        <p class="description">URL generated when deploying Google Apps Script Web App (Must end with <code>/exec</code>).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="cmx-minimum">Minimum location count safety floor</label></th>
                    <td>
                        <input id="cmx-minimum" type="number" min="1" name="minimum_locations" value="<?php echo esc_attr($options['minimum_locations']); ?>">
                        <p class="description">A feed with fewer valid locations than this number will be rejected to protect the live map from accidental sheet wipes.</p>
                    </td>
                </tr>
            </table>

            <p class="submit">
                <input type="submit" name="submit" id="submit" class="button button-primary" value="Save & Sync Now">
            </p>
        </form>

        <h2>Sync Status & Health Diagnostics</h2>
        <table class="widefat striped" style="max-width: 800px; margin-bottom: 20px;">
            <tbody>
                <tr>
                    <td><strong>Automatic Sync Cron:</strong></td>
                    <td>
                        <?php if ($next_cron) : ?>
                            <span style="color: green; font-weight: bold;">Active</span> (Next run in <?php echo human_time_diff($next_cron); ?>)
                        <?php else : ?>
                            <span style="color: orange; font-weight: bold;">Auto-Healing</span> (Will reschedule on next page request)
                        <?php endif; ?>
                    </td>
                </tr>
                <tr>
                    <td><strong>Last Successful Sync:</strong></td>
                    <td><?php echo esc_html($options['last_sync_at'] ? date('Y-m-d H:i:s T', strtotime($options['last_sync_at'])) : 'Never'); ?></td>
                </tr>
                <tr>
                    <td><strong>Published Store Count:</strong></td>
                    <td><strong style="color: #2271b1; font-size: 1.1em;"><?php echo esc_html((string) $options['last_count']); ?> stores</strong></td>
                </tr>
                <?php if ($options['last_error']) : ?>
                <tr>
                    <td><strong style="color: #d63638;">Last Reported Error:</strong></td>
                    <td><code style="color: #d63638;"><?php echo esc_html($options['last_error']); ?></code></td>
                </tr>
                <?php endif; ?>
                <tr>
                    <td><strong>Cached JSON Feed URL:</strong></td>
                    <td><code><a href="<?php echo esc_url(cmx_locator_feed_url()); ?>" target="_blank"><?php echo esc_html(cmx_locator_feed_url()); ?></a></code></td>
                </tr>
                <tr>
                    <td><strong>REST API Feed Endpoint:</strong></td>
                    <td><code><a href="<?php echo esc_url(rest_url('cmx-locator/v1/feed')); ?>" target="_blank"><?php echo esc_html(rest_url('cmx-locator/v1/feed')); ?></a></code></td>
                </tr>
            </tbody>
        </table>
    </div>
    <?php
}
