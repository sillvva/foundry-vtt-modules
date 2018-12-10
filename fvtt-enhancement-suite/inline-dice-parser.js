/**
 * Inline Dice Parser
 * @author Matt DeKok <Sillvva>
 * @version 0.1.0
 */

class InlineDiceParser {

    /**
     * @constructor
     * @param {string} message - A chat message to be parsed
     */
    constructor(message) {
        this.message = message;
        return this.parse();
    }

    /**
     * Parses the chat message of dice and math
     * @returns {string} - Returns a parsed chat message
     */
    parse(toolTip = true) {
        // save html code so that it will continue to parse correctly
        let output = this.message.trim()
            .replace(/</g,'_--')
            .replace(/>/g,'--_')
            .replace(/_--_--/g,'<<')
            .replace(/--_--_/g,'>>');

        // create message nodes we can parse through
        output = '<message>'+output+'</message>';
        output = output
            .replace(/<</g, '<math>')
            .replace(/>>/g, '</math>')
            .replace(/\[\[/g, '<roll>')
            .replace(/\]\]/g, '</roll>');

        // parse the nodes
        let messageEl = $(output).get(0);
        output = messageEl.childNodes.length === 0 ?
            messageEl.innerHTML :
            this._parse(messageEl, messageEl.nodeName, toolTip);

        // restore the html code to its original state
        return output
            .replace(/_--/g,'<')
            .replace(/--_/g,'>');
    }

    /**
     * Converts the parsed html back into original syntax
     * @param html
     * @returns {string}
     * @private
     */
    _reverseParse(html) {
        return html
            .replace(/\<math\>/g, '<<')
            .replace(/\<\/math\>/g, '>>')
            .replace(/\<roll\>/g, '[[')
            .replace(/\<\/roll\>/g, ']]');
    }

    /**
     * Parses the XML nodes created by the parse() method.
     * @param {Object} xml - A DOM node to be parsed
     * @param {String} nodeName - Name of the origin node being parsed
     * @returns {String} - the parsed chat message
     * @private
     */
    _parse(xml, nodeName, toolTip) {
        const idRgx = /^(@(?<id>[^:]+):)/i;
        if(xml.childNodes.length === 1 ? (xml.childNodes[0].nodeName === '#text') : false) {
            const m = xml.innerHTML.match(idRgx);
            return this._interpretNode(xml.innerHTML.replace(idRgx,''), nodeName, m ? m.groups.id : Object.keys(this).length);
        } else if(xml.childNodes.length === 0) {
            const m = xml.nodeValue.match(idRgx);
            return this._interpretNode(xml.nodeValue.replace(idRgx,'') || '', nodeName, m ? m.groups.id : Object.keys(this).length);
        } else {
            let out = '';
            let outVal = '';
            xml.childNodes.forEach((node) => {
                const childNodeName = $(node).get(0).nodeName.toLowerCase();
                const add = this._parse($(node).get(0), childNodeName);
                if(nodeName.toLowerCase() === 'message') {
                    if(childNodeName === '#text') {
                        outVal += add;
                    } else {
                        const parseString = this._reverseParse('<'+childNodeName+'>'+$(node).get(0).innerHTML+'</'+childNodeName+'>');
                        if(xml.innerHTML.substr(0,1) !== '/' && toolTip) {
                            outVal += '<span title="'+parseString.replace(/"/g,'\\"')+'">'+add+'</span>';
                        } else {
                            outVal += add;
                        }
                    }
                }
                out += add;
            });

            if(nodeName.toLowerCase() === 'message') return outVal;

            return this._parse($('<'+nodeName+'>'+out+'</'+nodeName+'>').get(0), nodeName);
        }
    }

    /**
     * Interprets the node as either math or a dice string
     * @param value - node value
     * @param name - node name
     * @returns {String} - parsed node value
     * @private
     */
    _interpretNode(value, name, id = Object.keys(this).length) {
        if(value.length === 0) return value;
        if(name.toLowerCase() === 'math') {
            this[id+'_ref'] = {
                result: math.eval(value)
            };
            return math.eval(value);
        }
        if(name.toLowerCase() === 'roll') {
            if(Roll) { // For Foundry Virtual Tabletop
                const r = new Roll(value, {}).roll();
                const indDie = [];
                const result = math.eval(r.parts.reduce((whole, part) => {
                    if(part instanceof Die) {
                        indDie.push({sides: part.nsides, total: part.total});
                        return whole + part.total;
                    } else {
                        return whole + part;
                    }
                }, ''));
                this[id+'_ref'] = {
                    result: result,
                    roll: r,
                    rolls: indDie
                };
                return result;
            } else { // For general non-Application use
                this[id+'_ref'] = {
                    result: math.eval(value)
                };
                return this._parseDice(value);
            }
        }
        return value;
    }

    /**
     * Parses a dice string
     * @param {String} diceString - dice string to be parsed
     * @returns {String} - parsed dice string
     * @private
     */
    _parseDice(diceString) {
        const dQuery = new RegExp("(?<rolls>\\d*)d((?<faces>\\d+)(ro(\\<|\&lt\;)(?<rerollonce>\\d+))?(r(\\<|\&lt\;)(?<reroll>\\d+))?)?", "i");
        let m = diceString.trim().match(dQuery);
        if(!m) return 'Invalid Dice String';
        while(m) {
            const rolls = parseInt(m.groups.rolls || 1);
            const faces = parseInt(m.groups.faces);
            const rerollonce = parseInt(m.groups.rerollonce || 0);
            const reroll = parseInt(m.groups.reroll || 0);

            let result = 0;
            for(let i = 0; i < rolls; i++) {
                let roll = Math.floor((Math.random() * faces) + 1);
                if(rerollonce >= roll) {
                    roll = Math.floor((Math.random() * faces) + 1);
                } else if (reroll >= roll) {
                    do {
                        roll = Math.floor((Math.random() * faces) + 1);
                    } while(reroll >= roll);
                }
                result += roll;
            }

            diceString = diceString.replace(dQuery, result);
            m = diceString.trim().match(dQuery);
        }

        let result = parseFloat(diceString);
        if(isNaN(diceString)) {
            try {
                result = math.eval(diceString);
            }
            catch(e) {
                return e.message;
            }
        }

        return result;
    }
}