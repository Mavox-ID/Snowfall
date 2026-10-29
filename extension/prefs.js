import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const LEVEL_IDS = ['off', 'light', 'steady', 'heavy', 'variable'];
const LEVEL_LABELS = ['No snow', 'Light', 'Steady', 'Heavy', 'Variable (swells and eases on its own)'];

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, lower, upper, step, digits, subtitle = '') {
    const row = new Adw.SpinRow({
        title, subtitle, digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function shortcutRow(settings, key, title) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_strv(key)[0] ?? '';
    row.connect('apply', () => {
        const t = row.text.trim();
        settings.set_strv(key, t ? [t] : []);
    });
    return row;
}

export default class SnowfallPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(660, 760);

        const fall = new Adw.PreferencesPage({title: 'Snowfall', icon_name: 'weather-snow-symbolic'});
        const g1 = new Adw.PreferencesGroup({title: 'Snow'});
        g1.add(switchRow(settings, 'enabled', 'Snow enabled', 'Same as the Super+Alt+S shortcut'));

        const combo = new Adw.ComboRow({title: 'Intensity', model: Gtk.StringList.new(LEVEL_LABELS)});
        combo.selected = Math.max(0, LEVEL_IDS.indexOf(settings.get_string('intensity')));
        combo.connect('notify::selected', () => settings.set_string('intensity', LEVEL_IDS[combo.selected]));
        const sigIntensity = settings.connect('changed::intensity', () => {
            const i = LEVEL_IDS.indexOf(settings.get_string('intensity'));
            if (i >= 0 && combo.selected !== i) combo.selected = i;
        });
        window.connect('close-request', () => { settings.disconnect(sigIntensity); return false; });
        g1.add(combo);

        g1.add(spinRow(settings, 'density', 'Amount of snow', 0.2, 3, 0.1, 1, 'Multiplier on top of the chosen intensity'));
        g1.add(spinRow(settings, 'flake-size', 'Flake size', 0.5, 2.5, 0.1, 1));
        g1.add(spinRow(settings, 'wind', 'Wind', 0, 3, 0.1, 1, '0 means dead calm'));
        fall.add(g1);

        const piles = new Adw.PreferencesPage({title: 'Drifts', icon_name: 'view-grid-symbolic'});
        const g2 = new Adw.PreferencesGroup({title: 'Accumulation'});
        g2.add(switchRow(settings, 'accumulate', 'Accumulate drifts', 'When off, snow just falls past'));
        g2.add(spinRow(settings, 'accumulation-speed', 'Accumulation speed', 0.2, 6, 0.1, 1));
        g2.add(switchRow(settings, 'melt', 'Melt', 'Drifts slowly settle so they never take over the screen'));
        piles.add(g2);

        const g3 = new Adw.PreferencesGroup({title: 'Where snow lies'});
        g3.add(switchRow(settings, 'ground-snow', 'Bottom of the screen'));
        g3.add(spinRow(settings, 'ground-depth', 'Max drift height at the bottom (px)', 4, 80, 1, 0));
        g3.add(switchRow(settings, 'window-snow', 'On windows', 'Only those with free space above them'));
        g3.add(switchRow(settings, 'dock-snow', 'On the dock / taskbar', 'Detected automatically (Dash to Dock, Dash to Panel, etc.)'));
        g3.add(spinRow(settings, 'ledge-depth', 'Max drift height on windows and dock (px)', 3, 40, 1, 0));
        piles.add(g3);

        const sys = new Adw.PreferencesPage({title: 'System', icon_name: 'preferences-system-symbolic'});
        const g4 = new Adw.PreferencesGroup({title: 'Behavior'});
        g4.add(switchRow(settings, 'cursor-interaction', 'Cursor plows snow', 'Move the mouse through a drift or through falling snow'));
        g4.add(switchRow(settings, 'behind-windows', 'Snow behind windows', 'Otherwise snow falls on top of everything'));
        g4.add(switchRow(settings, 'hide-on-fullscreen', 'Hide in fullscreen apps'));
        g4.add(spinRow(settings, 'fps', 'Frame rate', 15, 60, 5, 0, 'Higher is smoother but uses more CPU'));
        g4.add(switchRow(settings, 'show-indicator', 'Top bar icon'));
        sys.add(g4);

        const g5 = new Adw.PreferencesGroup({
            title: 'Keyboard shortcuts',
            description: 'Format: <Super><Alt>s. Confirm with the button on the right.',
        });
        g5.add(shortcutRow(settings, 'toggle-shortcut', 'Toggle snow on/off'));
        g5.add(shortcutRow(settings, 'clear-shortcut', 'Sweep away all snow'));
        sys.add(g5);

        window.add(fall);
        window.add(piles);
        window.add(sys);
    }
}
