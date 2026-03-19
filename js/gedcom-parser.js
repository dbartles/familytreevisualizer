/**
 * GEDCOM Parser — Parses GEDCOM 5.5.1 and 7.0 files into Person/Family data model
 */

class Person {
    constructor(id) {
        this.id = id;
        this.name = '';
        this.givenName = '';
        this.surname = '';
        this.sex = '';
        this.birthDate = '';
        this.birthPlace = '';
        this.deathDate = '';
        this.deathPlace = '';
        this.familyChildId = null;   // FAM where this person is a child
        this.familySpouseIds = [];   // FAMs where this person is a spouse
        this.generation = null;
        this.country = '';
    }
}

class Family {
    constructor(id) {
        this.id = id;
        this.husbandId = null;
        this.wifeId = null;
        this.childIds = [];
    }
}

class GEDCOMParser {
    constructor() {
        this.persons = new Map();
        this.families = new Map();
        this.rootPersonId = null;
    }

    /**
     * Parse a GEDCOM file string into Person/Family maps
     */
    parse(text) {
        this.persons.clear();
        this.families.clear();

        const lines = text.split(/\r?\n/);
        let currentRecord = null;  // { type: 'INDI'|'FAM', id: string }
        let currentSubTag = null;  // e.g. 'BIRT', 'DEAT', 'NAME'
        let currentPerson = null;
        let currentFamily = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parsed = this._parseLine(line);
            if (!parsed) continue;

            const { level, xref, tag, value } = parsed;

            if (level === 0) {
                // Save previous record
                currentSubTag = null;

                if (tag === 'INDI') {
                    currentRecord = { type: 'INDI', id: xref };
                    currentPerson = new Person(xref);
                    this.persons.set(xref, currentPerson);
                    currentFamily = null;
                } else if (tag === 'FAM') {
                    currentRecord = { type: 'FAM', id: xref };
                    currentFamily = new Family(xref);
                    this.families.set(xref, currentFamily);
                    currentPerson = null;
                } else {
                    currentRecord = null;
                    currentPerson = null;
                    currentFamily = null;
                }
                continue;
            }

            if (!currentRecord) continue;

            // Individual records
            if (currentRecord.type === 'INDI' && currentPerson) {
                if (level === 1) {
                    currentSubTag = tag;

                    switch (tag) {
                        case 'NAME':
                            currentPerson.name = value ? value.replace(/\//g, '').trim() : '';
                            break;
                        case 'SEX':
                            currentPerson.sex = value || '';
                            break;
                        case 'BIRT':
                        case 'DEAT':
                            // Sub-tags (DATE, PLAC) follow at level 2
                            break;
                        case 'FAMC':
                            currentPerson.familyChildId = value || '';
                            break;
                        case 'FAMS':
                            if (value) currentPerson.familySpouseIds.push(value);
                            break;
                    }
                } else if (level === 2) {
                    if (currentSubTag === 'NAME') {
                        if (tag === 'GIVN') currentPerson.givenName = value || '';
                        if (tag === 'SURN') currentPerson.surname = value || '';
                    } else if (currentSubTag === 'BIRT') {
                        if (tag === 'DATE') currentPerson.birthDate = value || '';
                        if (tag === 'PLAC') currentPerson.birthPlace = value || '';
                    } else if (currentSubTag === 'DEAT') {
                        if (tag === 'DATE') currentPerson.deathDate = value || '';
                        if (tag === 'PLAC') currentPerson.deathPlace = value || '';
                    }
                }
            }

            // Family records
            if (currentRecord.type === 'FAM' && currentFamily) {
                if (level === 1) {
                    switch (tag) {
                        case 'HUSB':
                            currentFamily.husbandId = value || '';
                            break;
                        case 'WIFE':
                            currentFamily.wifeId = value || '';
                            break;
                        case 'CHIL':
                            if (value) currentFamily.childIds.push(value);
                            break;
                    }
                }
            }
        }

        // Extract country from birthPlace for all persons
        for (const person of this.persons.values()) {
            person.country = this._extractCountry(person.birthPlace);
        }

        // Auto-detect root person (first INDI record)
        if (this.persons.size > 0) {
            this.rootPersonId = this.persons.keys().next().value;
        }

        return {
            persons: this.persons,
            families: this.families,
            rootPersonId: this.rootPersonId
        };
    }

    /**
     * Parse a single GEDCOM line
     * Format: LEVEL [XREF] TAG [VALUE]
     * GEDCOM 7.0 uses @XREF@ for cross-references
     */
    _parseLine(line) {
        // Match: level (optional @xref@) tag (optional value)
        const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s+(.*))?$/);
        if (!match) return null;

        let level = parseInt(match[1], 10);
        let xref = match[2] || null;
        let tag = match[3];
        let value = match[4] || '';

        // If tag looks like an xref and there's a value that's a tag
        // Handle: "0 @X123@ INDI" where xref=@X123@ tag=INDI
        // This is already handled by the regex

        // Clean xref references in values (remove @ signs for storage but keep for lookups)
        // Actually, keep @ signs for consistent ID references

        return { level, xref, tag, value };
    }

    /**
     * Extract and normalize country from a place string.
     * Tries the last comma-separated segment first; if it resolves to a US state,
     * checks the second-to-last segment too. Normalizes historical names,
     * abbreviations, misspellings, and non-English names to standard countries.
     */
    _extractCountry(place) {
        if (!place) return '';
        const parts = place.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return '';

        // Try last segment first
        let raw = parts[parts.length - 1];
        // Strip trailing >, parens, periods, question marks
        raw = raw.replace(/[>)?.]+$/g, '').trim();

        let country = this._normalizeCountry(raw);

        // If last segment resolved to a US state, the actual country is US
        if (country === '_US_STATE') {
            return 'United States';
        }

        // If we couldn't identify it, walk segments right-to-left looking for a country
        if (!country) {
            for (let i = parts.length - 2; i >= 0; i--) {
                let rawN = parts[i].replace(/[>)?.]+$/g, '').trim();
                let countryN = this._normalizeCountry(rawN);
                if (countryN === '_US_STATE') return 'United States';
                if (countryN) return countryN;
            }
        }

        return country || '';
    }

    /**
     * Normalize a raw place segment to a standard country name.
     * Returns '_US_STATE' if it's a US state/abbreviation.
     * Returns '' if unrecognizable.
     */
    _normalizeCountry(raw) {
        if (!raw) return '';
        const s = raw.trim();
        const lower = s.toLowerCase().replace(/[.>)]+$/g, '').trim();

        // US states and abbreviations → marker
        const usStates = new Set([
            'alabama','alaska','arizona','arkansas','california','colorado',
            'connecticut','delaware','florida','georgia','hawaii','idaho',
            'illinois','indiana','iowa','kansas','kentucky','louisiana',
            'maine','maryland','massachusetts','michigan','minnesota',
            'mississippi','missouri','montana','nebraska','nevada',
            'new hampshire','new jersey','new mexico','new york','north carolina',
            'north dakota','ohio','oklahoma','oregon','pennsylvania',
            'rhode island','south carolina','south dakota','tennessee','texas',
            'utah','vermont','virginia','washington','west virginia',
            'wisconsin','wyoming','district of columbia',
            // Common abbreviations
            'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id',
            'il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms',
            'mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok',
            'or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv',
            'wi','wy','dc',
            // Period abbreviations
            'conn','mass','penn','tenn','fla','ill','ind',
            'va','pa','ny','mo','md','ne','oh','ky',
        ]);
        if (usStates.has(lower)) return '_US_STATE';

        // Country normalization map
        const countryMap = {
            // English-speaking
            'united states': 'United States', 'united states of america': 'United States',
            'usa': 'United States', 'us': 'United States', 'u s a': 'United States',
            'u. s. a.': 'United States', 'u.s.a.': 'United States',
            'united statec': 'United States', 'pennsylvania usa': 'United States',
            'king and queen virginia usa': 'United States',
            'massachusetts united states': 'United States',
            'virginia united states': 'United States',
            'england': 'England', 'eng': 'England', 'engl': 'England',
            'olde england': 'England', 'egnland': 'England',
            'kingdom of england': 'England', 'probably in england': 'England',
            'scotland': 'Scotland', 'scot': 'Scotland', 'sctl': 'Scotland',
            'scotland uk': 'Scotland', 'of scotland': 'Scotland',
            'ireland': 'Ireland', 'ire': 'Ireland', 'northern ireland': 'Ireland',
            'wales': 'Wales',
            'united kingdom': 'United Kingdom', 'uk': 'United Kingdom',
            'great britain': 'United Kingdom', 'kingdom of great britain': 'United Kingdom',
            'united kingdom europe': 'United Kingdom',
            'france': 'France', 'francia': 'France', 'francja': 'France',
            'frankrijk': 'France',
            'germany': 'Germany', 'deutschland': 'Germany', 'deutzland': 'Germany',
            'niemcy': 'Germany', 'german empire': 'Germany',
            'deutschland (hrr)': 'Germany',
            'norway': 'Norway', 'norge': 'Norway', 'norw': 'Norway',
            'nor': 'Norway', 'nrwy': 'Norway', 'norwa': 'Norway',
            'noway': 'Norway',
            'sweden': 'Sweden', 'sverige': 'Sweden', 'swed': 'Sweden',
            'switzerland': 'Switzerland', 'switz': 'Switzerland',
            'schweiz': 'Switzerland', 'szwajcaria': 'Switzerland',
            'old swiss confederacy': 'Switzerland',
            'netherlands': 'Netherlands', 'nederland': 'Netherlands',
            'denmark': 'Denmark', 'danmark': 'Denmark',
            'belgium': 'Belgium',
            'finland': 'Finland',
            'luxembourg': 'Luxembourg',
            'isle of man': 'Isle of Man', 'guernsey': 'Guernsey',
            'channel island': 'Channel Islands',
            'brazil': 'Brazil', 'estados unidos de américa': 'United States',
            'bavaria': 'Germany', 'bayern': 'Germany',
            'saxony': 'Germany', 'sachsen': 'Germany',
            'prussia': 'Germany', 'holy roman empire': 'Germany',
            'heiliges römisches reich': 'Germany',
            // Colonial / historical Americas
            'british colonial america': 'Colonial America',
            'british colonial  america': 'Colonial America',
            'british colonia america': 'Colonial America',
            'british colonia america': 'Colonial America',
            'britrish colonial america': 'Colonial America',
            'british coloial america': 'Colonial America',
            'british colonial america.': 'Colonial America',
            'british america': 'Colonial America',
            'british  america': 'Colonial America',
            'british america colonies': 'Colonial America',
            'british american colony': 'Colonial America',
            'british colonies': 'Colonial America',
            'british colony america': 'Colonial America',
            'british north america': 'Colonial America',
            'colonial america': 'Colonial America',
            'american british colonies': 'Colonial America',
            'american colonies': 'Colonial America',
            'british colonial america and rhode island': 'Colonial America',
            'colony of virginia': 'Colonial America',
            'virginia british colony': 'Colonial America',
            'royal colony of virginia': 'Colonial America',
            'connecticut colony': 'Colonial America',
            'connecticut british america': 'Colonial America',
            'massachusetts bay colony': 'Colonial America',
            'maryland colony': 'Colonial America',
            'pennsylvania colony': 'Colonial America',
            'pennsylvannia colony': 'Colonial America',
            'new netherland': 'Colonial America',
            'new netherlands': 'Colonial America',
            'new sweden': 'Colonial America',
            'new england': 'Colonial America',
            'british colonial america': 'Colonial America',
            'british  colonial america': 'Colonial America',
            'british colonia america': 'Colonial America',
            'river colony': 'Colonial America',
            'prob virginia': 'Colonial America',
            'of penn': 'Colonial America',
            // French / other
            'écosse': 'Scotland', 'suède': 'Sweden', 'norvège': 'Norway',
            'turquie': 'Turkey', 'alemanha': 'Germany',
            'schotland': 'Scotland',
            'west indies': 'West Indies', 'caribbean': 'West Indies',
            'saint helena': 'Saint Helena',
        };

        const mapped = countryMap[lower];
        if (mapped) return mapped;

        // Check if it contains a known country name as substring
        if (lower.includes('england')) return 'England';
        if (lower.includes('scotland')) return 'Scotland';
        if (lower.includes('ireland')) return 'Ireland';
        if (lower.includes('norway')) return 'Norway';
        if (lower.includes('sweden')) return 'Sweden';
        if (lower.includes('wales')) return 'Wales';

        // Inline US state references: "Concord Franklin PA", "Middlesex Co. VA"
        if (/\b(pa|va|nj|ny|ct|ma|md|nc|sc|oh|ky|tn|ga|al)\s*$/i.test(s)) return '_US_STATE';

        // Normalize: strip all dots/spaces for abbreviation matching
        const stripped = lower.replace(/[\s.]+/g, '');

        // US state abbreviations with various punctuation: "N.J.", "N. J.", "W Va", etc.
        const usAbbrStripped = new Set([
            'nj','ny','wva','ct','de','pa','ma','md','va','ri',
            'conneticut','deleware','pennyslvania',
        ]);
        if (usAbbrStripped.has(stripped)) return '_US_STATE';

        // "Sxny" = Saxony = Germany
        if (lower.startsWith('sxny')) return 'Germany';

        // Place strings containing state + country inline
        if (lower.includes('virginia') || lower.includes('kentucky') ||
            lower.includes('carolina') || lower.includes('ohio') ||
            lower.includes('pennsylvania') || lower.includes('colonial america')) {
            return lower.includes('colonial') ? 'Colonial America' : 'United States';
        }

        // "U. S. A." with spaces
        if (stripped === 'usa') return 'United States';

        // Skip clearly non-country values: numbers, very short unknowns
        if (/^\d+$/.test(lower)) return '';
        if (lower.length <= 1) return '';
        if (lower.startsWith('poss ') || lower.startsWith('of ') || lower.startsWith('prob ')) return '';
        if (lower === 'europe' || lower === 'europa') return '';
        if (lower.startsWith('and ')) return '';
        if (lower.includes('aboard') || lower.includes('nation') || lower.includes('leni')) return '';

        // German regions/cities
        const germanRegions = [
            'mayen-koblenz', 'koblenz', 'zweibrucken', 'auggen',
            'sebastian-engers', 'andernach', 'kettig', 'hardingstone',
            'pfaffenwißbach', 'mülheim-kärlich',
        ];
        if (germanRegions.includes(lower)) return 'Germany';
        // German zip codes
        if (/^\d{5}$/.test(lower)) return 'Germany';

        // Norwegian regions
        const norwegianRegions = ['buskerud', 'vestre slidre', 'hemsedal'];
        if (norwegianRegions.includes(lower) || lower.includes('hemsedal')) return 'Norway';

        // Swedish regions
        if (lower.includes('jemtland') || lower.includes('sweden') || lower === 'västernorrland'
            || lower === 'rydaholm' || lower.includes('halsingland')) return 'Sweden';
        if (lower.includes('hackås') || lower.includes('transjö')) return 'Sweden';

        // English villages/places (no comma-separated country)
        if (lower === 'hardingstone') return 'England';

        return '';
    }

    /**
     * Compute generation numbers via BFS from a root person
     * Root person = generation 0, parents = generation 1, etc.
     */
    computeGenerations(rootId) {
        if (!rootId || !this.persons.has(rootId)) return;

        // Reset all generations
        for (const person of this.persons.values()) {
            person.generation = null;
        }

        const queue = [rootId];
        this.persons.get(rootId).generation = 0;

        while (queue.length > 0) {
            const currentId = queue.shift();
            const current = this.persons.get(currentId);
            if (!current) continue;

            const gen = current.generation;

            // Find parents via familyChildId
            if (current.familyChildId) {
                const family = this.families.get(current.familyChildId);
                if (family) {
                    for (const parentId of [family.husbandId, family.wifeId]) {
                        if (parentId) {
                            const parent = this.persons.get(parentId);
                            if (parent && parent.generation === null) {
                                parent.generation = gen + 1;
                                queue.push(parentId);
                            }
                        }
                    }
                }
            }

            // Find children via familySpouseIds
            for (const famId of current.familySpouseIds) {
                const family = this.families.get(famId);
                if (family) {
                    for (const childId of family.childIds) {
                        const child = this.persons.get(childId);
                        if (child && child.generation === null) {
                            child.generation = gen - 1;
                            queue.push(childId);
                        }
                    }
                }
            }
        }
    }

    /**
     * Get max generation number
     */
    getMaxGeneration() {
        let max = 0;
        for (const person of this.persons.values()) {
            if (person.generation !== null && person.generation > max) {
                max = person.generation;
            }
        }
        return max;
    }

    /**
     * Get all persons as an array
     */
    getPersonsArray() {
        return Array.from(this.persons.values());
    }

    /**
     * Search persons by name
     */
    searchPersons(query) {
        const q = query.toLowerCase();
        return this.getPersonsArray().filter(p =>
            p.name.toLowerCase().includes(q)
        );
    }
}
