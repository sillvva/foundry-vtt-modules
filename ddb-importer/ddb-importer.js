/**
 * @author Matt DeKok <Sillvva>
 * @version 0.1
 */

class BeyondImporter extends Application {

    constructor(app) {
        super(app);

        this.hookActorSheet();
        this.hookActorList();
    }

    /**
     * Hook into the render call for the Actor5eSheet to add an extra button
     */
    hookActorSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            // console.log(app, data);
            if(!data.owner) return;

            const windowHeader = html.parent().parent().find('.window-header');
            const windowCloseBtn = windowHeader.find('.close');
            const importButton = $('<a class="import-dndbeyond-sheet"><span class="fas fa-file-import"></span> Beyond Import</a>');

            windowHeader.find('.import-dndbeyond-sheet').remove();
            windowCloseBtn.before(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.importDialog({ actor: app.actor });
            });
        });
    }

    /**
     * Hook into the render call for the ActorList to add an extra button
     */
    hookActorList() {
        Hooks.on('renderActorList', (app, html, data) => {
            const importButton = $('<button class="import-dndbeyond-list" style="min-width: 96%;"><span class="fas fa-file-import"></span> Beyond Import</button>');

            html.find('.import-dndbeyond-list').remove();
            html.find('.directory-footer').append(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.importDialog({ actor: null });
            });
        });
    }

    /**
     * Render the import dialog
     *
     * @param {Object} options - Options to modify the import behavior
     *
     * @example
     * // Creates a new actor entity
     * importCharacterData({ actor: null });
     *
     * @example
     * // Also creates a new actor entity
     * importCharacterData();
     *
     * @example
     * // Assign existing actor entity
     * // Actor5e is defined as an instance of the Actor5e class
     * importCharacterData({ actor: Actor5e });
     */
    importDialog(options = {}) {
        let out = '';

        out += '<p>Follow these instructions to get your character data from D&amp;D Beyond.</p>';
        out += '<ol>';
        out += '<li>Open your character sheet (not the builder) in D&amp;D Beyond.</li>';
        out += '<li>In your address bar, append <strong>/json</strong> to the end of the URL. It should look like this:<br /><small><em>https://www.dndbeyond.com/profile/username/characters/1234567<strong>/json</strong></em></small></li>';
        out += '<li>Copy the data on this page into the box below.</li>';
        out += '</ol>';
        out += '<p><textarea class="ddb-data form-control" cols="30" rows="5" autofocus placeholder="Paste your character data here"></textarea></p>';

        const d = new Dialog({
            title: "D&D Beyond Character Import",
            content: out,
            buttons: {
                "import": {
                    icon: '',
                    label: "Import",
                    callback: (e) => {
                        const characterData = document.querySelector('.ddb-data').value;
                        this.importCharacterData(characterData, options);
                    }
                },
                "cancel": {
                    icon: '',
                    label: "Cancel",
                    callback: () => {}
                }
            }
        });
        d.render(true);
    }

    /**
     * Import character data and create or get the actor and pass the data to the parser
     *
     * @param {String} characterData - Character JSON data string copied from the D&D Beyond website
     * @param {Object} options - Options to modify the import behavior
     */
    importCharacterData(characterData, options) {
        // Merge options and defaults
        const defaults = {
            actor: null
        };
        let opts = Object.assign(defaults, options);

        // Check data integrity
        let data = null;
        try {
            data = JSON.parse(characterData);
        }
        catch(e) {
            console.error('Unable to parse invalid character data');
            console.error(e.message);
            return;
        }

        if (data === null) {
            console.error('No character data provided');
            return;
        }

        // Create new actor (GM only) if entity is not pre-defined
        if(opts.actor === null) {
            Actor5e.create({ name: data.character.name, type: 'character' }, true).then(actor => {
                this.parseCharacterData(actor, data);
            });
        } else {
            this.parseCharacterData(opts.actor, data);
        }
    }

    /**
     * Parse character data into the actor sheet
     *
     * @param {String} actorEntity - The Actor5e entity that will be updated with the new data
     * @param {Object} data - Character JSON data string parsed as an object after import
     */
    parseCharacterData(actorEntity, data) {
        let actor = Object.assign({}, actorEntity.data);
        let character = data.character;
        delete actor._id;
        console.log(game);
        console.log(data);

        actor.img = character.avatarUrl;

        // Set Details
        actor.data.details.level.value = character.classes.reduce((total, charClass) => total + charClass.level, 0);
        actor.data.details.race.value = character.race.fullName;
        actor.data.details.alignment.value = this._getConfig('alignments', 'id', character.alignmentId).long;
        actor.data.details.background.value = character.background.definition != null ? character.background.definition.name : (character.background.customBackground != null ? character.background.customBackground.name : '');
        actor.data.details.xp.value = character.currentXp.toString();

        // Set Attributes
        actor.data.attributes.prof.value = Math.floor((actor.data.details.level.value + 7) / 4);
        actor.data.attributes.hd.value = actor.data.details.level.value;
        actor.data.attributes.hp.value = this.getHp(character).toString();
        actor.data.attributes.hp.max = this.getHp(character).toString();
        actor.data.attributes.spellcasting.value = '';
        actor.data.attributes.speed.value = this.getSpeeds(character);

        // Set Traits
        let senses = [];
        this._getObjects(character.modifiers, 'type', 'sense').forEach((sense) => {
            if (senses.indexOf(sense.friendlySubtypeName) === -1) {
                let name = sense.friendlySubtypeName;
                if(sense.value != null) name += ' '+sense.value+' ft.'
                senses.push(name);
            }
        });
        actor.data.traits.senses.value = senses.join(', ');

        // Set Abilities
        for (let abl in actor.data.abilities) {
            const ability = actor.data.abilities[abl];
            const profs = [];
            for (let modType in character.modifiers) {
                character.modifiers[modType].filter((mod) => {
                    return mod.type === 'proficiency' && mod.subType === ability.label.toLowerCase().replace(/ /g, '-')+'-saving-throws' && mod.isGranted;
                }).forEach((mod) => {
                    profs.push(mod);
                });
            }
            if (profs.length > 0) { actor.data.abilities[abl].proficient = '1'; }
            else { actor.data.abilities[abl].proficient = '0'; }

            actor.data.abilities[abl].value = this.getTotalAbilityScore(character, this._getConfig('abilities', 'short', abl).id).toString();
            actor.data.abilities[abl].min = 0;
            actor.data.abilities[abl].mod = Math.floor((actor.data.abilities[abl].value - 10) / 2);
            actor.data.abilities[abl].save = Math.floor((actor.data.abilities[abl].value - 10) / 2);

            if(actor.data.abilities[abl].proficient === '1') {
                actor.data.abilities[abl].save += actor.data.attributes.prof.value;
            }
        }

        // Set Class Levels, Spellcasting Ability
        character.classes.forEach((charClass) => {
            const item = {
                img: 'icons/mystery-man.png',
                name: charClass.definition.name,
                type: 'class',
                data: {
                    description: { type: "String", label: "Description", value: "" },
                    levels: { type: "String", label: "Class Levels", value: charClass.level.toString() },
                    source: { type: "String", label: "Source" },
                    subclass: { type: "String", label: "Subclass", value: charClass.subclassDefinition === null ? '' : charClass.subclassDefinition.name }
                }
            };

            if(actor.items.filter(it => it.name === item.name).length > 0) {
                const it = actor.items.filter(it => it.name === item.name)[0];
                actorEntity.updateOwnedItem(it, Object.assign(it, item));
            } else {
                actorEntity.createOwnedItem(item, true);
            }

            if (actor.data.attributes.spellcasting.value === '') {
                if (charClass.spellCastingAbilityId != null) {
                    actor.data.attributes.spellcasting.value = this._getConfig('abilities', 'id', charClass.spellCastingAbilityId).short;
                } else if (charClass.subclassDefinition != null) {
                    if (charClass.subclassDefinition.spellCastingAbilityId != null) {
                        actor.data.attributes.spellcasting.value = this._getConfig('abilities', 'id', charClass.subclassDefinition.spellCastingAbilityId).short;
                    }
                }

                if(actor.data.attributes.spellcasting.value !== '') {
                    actor.data.attributes.spelldc.value = 8 + actor.data.abilities[actor.data.attributes.spellcasting.value].mod + actor.data.attributes.prof.value;
                }
            }
        });

        // Set Skills / Passive Perception
        for(let skl in actor.data.skills) {
            let skill = actor.data.skills[skl];
            const skillData = this._getObjects(character, 'friendlySubtypeName', skill.label);
            const prof = skillData.filter(sp => sp.type === 'proficiency').length > 0;
            const exp = skillData.filter(sp => sp.type === 'expertise').length > 0;
            const bonus = skillData.filter(sb => sb.type === 'bonus').reduce((total, skillBon) => {
                let bon = 0;
                if (skillBon.value != null) {
                    bon = skillBon.value;
                } else if (skillBon.statId != null) {
                    bon = actor.data.abilities[this._getConfig('abilities', 'id', skillBon.statId).short].mod;
                }
                return total + bon;
            }, 0) + (prof ? actor.data.attributes.prof.value + (exp ? actor.data.attributes.prof.value : 0) : 0);

            skill.value = prof ? 1 + (exp ? 1 : 0) : 0;
            skill.mod = actor.data.abilities[skill.ability].mod + bonus;

            // passive perception
            if(skill.label === 'Perception') {
                actor.data.traits.perception.value = 10 + skill.mod;
            }

            actor.data.skills[skl] = skill;
        }

        actorEntity.update(actor, true);
    }

    /**
     * Get character hit points
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getHp(character) {
        const totalLevel = character.classes.reduce((total, charClass) => total + charClass.level, 0);
        let hp = Math.floor(character.baseHitPoints + ( totalLevel * Math.floor( ( ( this.getTotalAbilityScore(character, 3) - 10 ) / 2 ) ) ) );

        // scan for modifiers except those in items, because we will get those bonuses from the items once they are imported
        // NOTE: this also handles the problem that Beyond includes modifiers from items that are not currently equipped/attuned
        this._getObjects(character.modifiers, 'subType', 'hit-points-per-level', ['item']).forEach((bonus) => {
            let level = totalLevel;

            // Ensure that per-level bonuses from class features only apply for the levels of the class and not the character's total level.
            let charClasses = character.classes.filter((charClass) => {
                let output = charClass.definition.classFeatures.findIndex(cF => cF.id === bonus.componentId) >= 0;
                if (charClass.subclassDefinition != null) {
                    output = output || charClass.subclassDefinition.classFeatures.findIndex(cF => cF.id === bonus.componentId) >= 0;
                }
                return output;
            });

            if (charClasses.length > 0) {
                level = 0;
                charClasses.forEach((charClass) => {
                    level += parseInt(charClass.level);
                });
            }

            hp += level * bonus.value;
        });

        return hp;
    }

    /**
     * Get character speeds (walking, swimming, flying, etc.)
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getSpeeds(character) {
        let weightSpeeds = character.race.weightSpeeds;
        if(weightSpeeds === null) {
            weightSpeeds = {
                "normal": {
                    "walk": 30,
                    "fly": 0,
                    "burrow": 0,
                    "swim": 0,
                    "climb": 0
                }
            };
        }

        let speedMods = this._getObjects(character.modifiers, 'subType', 'speed');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'set') {
                    weightSpeeds.normal.walk = (speedMod.value > weightSpeeds.normal.walk ? speedMod.value : weightSpeeds.normal.walk);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-flying');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'set' && speedMod.id.indexOf('spell') === -1) {
                    if(speedMod.value === null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.fly = (speedMod.value > weightSpeeds.normal.fly ? speedMod.value : weightSpeeds.normal.fly);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-swimming');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'set' && speedMod.id.indexOf('spell') === -1) {
                    if(speedMod.value === null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.swim = (speedMod.value > weightSpeeds.normal.swim ? speedMod.value : weightSpeeds.normal.swim);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-climbing');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'set' && speedMod.id.indexOf('spell') === -1) {
                    if(speedMod.value === null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.climb = (speedMod.value > weightSpeeds.normal.climb ? speedMod.value : weightSpeeds.normal.climb);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'unarmored-movement');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'bonus') {
                    speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
                    weightSpeeds.normal.walk += speedMod.value;
                    if(weightSpeeds.normal.fly > 0) weightSpeeds.normal.fly += speedMod.value;
                    if(weightSpeeds.normal.swim > 0) weightSpeeds.normal.swim += speedMod.value;
                    if(weightSpeeds.normal.climb > 0) weightSpeeds.normal.climb += speedMod.value;
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'speed');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type === 'bonus') {
                    speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
                    weightSpeeds.normal.walk += speedMod.value;
                    if(weightSpeeds.normal.fly > 0) weightSpeeds.normal.fly += speedMod.value;
                    if(weightSpeeds.normal.swim > 0) weightSpeeds.normal.swim += speedMod.value;
                    if(weightSpeeds.normal.climb > 0) weightSpeeds.normal.climb += speedMod.value;
                }
            });
        }

        let speed = weightSpeeds.normal.walk + 'ft.';
        for(let key in weightSpeeds.normal){
            if(key !== 'walk' && weightSpeeds.normal[key] !== 0){
                speed += ', ' + key + ' ' + weightSpeeds.normal[key] + 'ft.';
            }
        }

        return speed;
    }

    /**
     * Get total ability score including modifiers
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     * @param {Number} scoreId - 1 = STR, 2 = DEX, 3 = CON, 4 = INT, 5 = WIS, 6 = DEX
     */
    getTotalAbilityScore(character, scoreId) {
        let index = scoreId-1;
        let base = (character.stats[index].value === null ? 10 : character.stats[index].value),
            bonus = (character.bonusStats[index].value === null ? 0 : character.bonusStats[index].value),
            override = (character.overrideStats[index].value === null ? 0 : character.overrideStats[index].value),
            total = base + bonus,
            modifiers = this._getObjects(character, '', this._getConfig('abilities', 'id', scoreId).long + "-score");
        if (override > 0) total = override;
        if (modifiers.length > 0) {
            let used_ids = [];
            for (let i = 0; i < modifiers.length; i++){
                if (modifiers[i].type === 'bonus' && used_ids.indexOf(modifiers[i].id) === -1) {
                    total += modifiers[i].value;
                    used_ids.push(modifiers[i].id);
                }
            }
        }

        return total;
    }

    /**
     * Return an array of objects according to key, value, or key and value matching, optionally ignoring objects in array of names
     *
     * @param {Object} obj - An object to iterate through searching for objects containing a key/value pair
     * @param {String} key - An object parameter key to search by
     * @param {Any} val - A value to search for
     * @param {String[]} except - An array of keys to ignore
     */
    _getObjects(obj, key, val, except = []) {
        let objects = [];
        for (let i in obj) {
            if (!obj.hasOwnProperty(i)) continue;
            if (typeof obj[i] === 'object') {
                if (except.indexOf(i) !== -1) {
                    continue;
                }
                objects = objects.concat(this._getObjects(obj[i], key, val));
            } else
            //if key matches and value matches or if key matches and value is not passed (eliminating the case where key matches but passed value does not)
            if (i === key && obj[i] === val || i === key && val === '') { //
                objects.push(obj);
            } else if (obj[i] === val && key === ''){
                //only add if the object is not already in the array
                if (objects.lastIndexOf(obj) === -1){
                    objects.push(obj);
                }
            }
        }
        return objects;
    }

    _getConfig(type, key, value) {
        return CONFIG.BeyondImporter[type].find((item) => {
            return item[key] === value;
        });
    }
}

let ddbi = new BeyondImporter();
ddbi.render();

CONFIG.BeyondImporter = {
    abilities: [
        { id: 1, short: 'str', long: 'Strength' },
        { id: 2, short: 'dex', long: 'Dexterity' },
        { id: 3, short: 'con', long: 'Constitution' },
        { id: 4, short: 'int', long: 'Intelligence' },
        { id: 5, short: 'wis', long: 'Wisdom' },
        { id: 6, short: 'cha', long: 'Charisma' }
    ],
    alignments: [
        { id: 1, short: 'LG', long: 'Lawful Good' },
        { id: 2, short: 'NG', long: 'Neutral Good' },
        { id: 3, short: 'CG', long: 'Chaotic Good' },
        { id: 4, short: 'LN', long: 'Lawful Neutral' },
        { id: 5, short: 'N', long: 'Neutral' },
        { id: 6, short: 'CN', long: 'Chaotic Neutral' },
        { id: 7, short: 'LE', long: 'Lawful Evil' },
        { id: 8, short: 'NE', long: 'Neutral Evil' },
        { id: 9, short: 'CE', long: 'Chaotic Evil' }
    ]
};