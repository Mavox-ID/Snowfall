// Snowfall - snow on your GNOME Shell desktop
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Overlay} from './overlay.js';

const LEVELS = [
    ['off', 'No snow'],
    ['light', 'Light'],
    ['steady', 'Steady'],
    ['heavy', 'Heavy'],
    ['variable', 'Variable'],
];

const SnowIndicator = GObject.registerClass(
class SnowIndicator extends PanelMenu.Button {
    _init(extension, settings, overlay) {
        super._init(0.0, 'Snowfall', false);
        this._settings = settings;

        this._icon = new St.Icon({icon_name: 'weather-snow-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this._toggle = new PopupMenu.PopupSwitchMenuItem('Snowfall', settings.get_boolean('enabled'));
        this._toggle.connect('toggled', (_item, state) => settings.set_boolean('enabled', state));
        this.menu.addMenuItem(this._toggle);

        const sub = new PopupMenu.PopupSubMenuMenuItem('Intensity');
        this._levelItems = new Map();
        for (const [id, label] of LEVELS) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                settings.set_string('intensity', id);
                if (id !== 'off') settings.set_boolean('enabled', true);
            });
            sub.menu.addMenuItem(item);
            this._levelItems.set(id, item);
        }
        this.menu.addMenuItem(sub);

        this._accumulate = new PopupMenu.PopupSwitchMenuItem('Accumulate drifts', settings.get_boolean('accumulate'));
        this._accumulate.connect('toggled', (_item, state) => settings.set_boolean('accumulate', state));
        this.menu.addMenuItem(this._accumulate);

        this._melt = new PopupMenu.PopupSwitchMenuItem('Melt', settings.get_boolean('melt'));
        this._melt.connect('toggled', (_item, state) => settings.set_boolean('melt', state));
        this.menu.addMenuItem(this._melt);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const clear = new PopupMenu.PopupMenuItem('Sweep away all snow');
        clear.connect('activate', () => overlay.clear());
        this.menu.addMenuItem(clear);

        const prefs = new PopupMenu.PopupMenuItem('Settings…');
        prefs.connect('activate', () => extension.openPreferences());
        this.menu.addMenuItem(prefs);

        const id = settings.connect('changed', () => this._sync());
        this.connect('destroy', () => settings.disconnect(id));
        this._sync();
    }

    _sync() {
        const s = this._settings;
        const on = s.get_boolean('enabled');
        const level = s.get_string('intensity');
        this._toggle.setToggleState(on);
        this._accumulate.setToggleState(s.get_boolean('accumulate'));
        this._melt.setToggleState(s.get_boolean('melt'));
        for (const [id, item] of this._levelItems)
            item.setOrnament(id === level ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        this._icon.opacity = on && level !== 'off' ? 255 : 110;
    }
});

export default class SnowfallExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = new Overlay(this._settings);
        this._overlay.enable();

        this._indicator = null;
        this._syncIndicator();
        this._indicatorSig = this._settings.connect('changed::show-indicator', () => this._syncIndicator());

        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        Main.wm.addKeybinding('toggle-shortcut', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes,
            () => this._settings.set_boolean('enabled', !this._settings.get_boolean('enabled')));
        Main.wm.addKeybinding('clear-shortcut', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, modes,
            () => this._overlay.clear());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        Main.wm.removeKeybinding('clear-shortcut');

        if (this._indicatorSig) {
            this._settings.disconnect(this._indicatorSig);
            this._indicatorSig = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;

        this._overlay?.disable();
        this._overlay = null;
        this._settings = null;
    }

    _syncIndicator() {
        const want = this._settings.get_boolean('show-indicator');
        if (want && !this._indicator) {
            this._indicator = new SnowIndicator(this, this._settings, this._overlay);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!want && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
