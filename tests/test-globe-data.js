/**
 * Unit tests for GlobeView data generation
 * Run with: node tests/test-globe-data.js
 */

// Minimal polyfills for Node.js environment
if (typeof localStorage === 'undefined') {
    const store = {};
    global.localStorage = {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
        key: (i) => Object.keys(store)[i] || null,
        get length() { return Object.keys(store).length; },
        clear: () => { for (const k in store) delete store[k]; }
    };
}

const fs = require('fs');
const path = require('path');

// Load dependencies
const geocoderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'geocoder.js'), 'utf8');
const script = new (require('vm').Script)(geocoderSrc);
script.runInThisContext();

// We can't fully instantiate GlobeView (needs DOM + Globe.gl), so we test
// the data generation logic by extracting and testing computeLayout's logic directly.
// We create a minimal mock.

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message} — expected "${expected}", got "${actual}"`);
    }
}

/**
 * Simulate GlobeView.computeLayout logic for testability
 * Matches the real implementation: all persons placed, unknowns at 0,0
 */
function computeGlobeData(persons, families, geocodeResults, countryColors) {
    const pointsData = [];
    const lifeArcsData = [];
    const ancestorArcsData = [];
    const UNKNOWN = { lat: 0, lng: 0 };

    function getCoord(place) {
        return geocodeResults.get(place) || null;
    }

    function getColor(person) {
        return countryColors.get(person.country) || '#888888';
    }

    for (const person of persons.values()) {
        const birthCoord = person.birthPlace ? getCoord(person.birthPlace) : null;
        const deathCoord = person.deathPlace ? getCoord(person.deathPlace) : null;
        const color = getColor(person);

        // Birth point — always created (fallback to 0,0)
        const birthFinal = birthCoord || UNKNOWN;
        const birthUnknown = !birthCoord;
        pointsData.push({
            lat: birthFinal.lat, lng: birthFinal.lng,
            personId: person.id, type: 'birth',
            isUnknownLocation: birthUnknown
        });

        // Death point — if geocoded and different from birth
        if (deathCoord) {
            const sameLoc = birthCoord &&
                Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;
            if (!sameLoc) {
                pointsData.push({
                    lat: deathCoord.lat, lng: deathCoord.lng,
                    personId: person.id, type: 'death',
                    isUnknownLocation: false
                });
            }
        } else if (person.deathPlace) {
            // Death place exists but failed geocoding — place at 0,0
            pointsData.push({
                lat: 0, lng: 0,
                personId: person.id, type: 'death',
                isUnknownLocation: true
            });
        }

        // Life arc — only when BOTH have real coordinates
        if (birthCoord && deathCoord) {
            const sameLoc =
                Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;
            if (!sameLoc) {
                lifeArcsData.push({
                    personId: person.id, type: 'life'
                });
            }
        }

        // Ancestor arcs — only real coords
        if (birthCoord && person.familyChildId) {
            const family = families.get(person.familyChildId);
            if (family) {
                for (const parentId of [family.husbandId, family.wifeId]) {
                    if (!parentId) continue;
                    const parent = persons.get(parentId);
                    if (!parent || !parent.birthPlace) continue;
                    const parentCoord = getCoord(parent.birthPlace);
                    if (!parentCoord) continue;

                    const sameLoc =
                        Math.abs(birthCoord.lat - parentCoord.lat) < 0.01 &&
                        Math.abs(birthCoord.lng - parentCoord.lng) < 0.01;
                    if (sameLoc) continue;

                    ancestorArcsData.push({
                        personId: person.id,
                        parentId: parentId,
                        type: 'ancestor'
                    });
                }
            }
        }
    }

    return { pointsData, lifeArcsData, ancestorArcsData };
}

// ---- Tests ----

console.log('\n=== Globe Data Generation Tests ===\n');

// Test 1: Person with birth and death at different locations
console.log('--- Birth + Death (different locations) ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'John Smith',
        birthPlace: 'London, England', deathPlace: 'Paris, France',
        country: 'England', generation: 0, familyChildId: null
    });

    const families = new Map();
    const geo = new Map();
    geo.set('London, England', { lat: 51.5, lng: -0.12 });
    geo.set('Paris, France', { lat: 48.85, lng: 2.35 });
    const colors = new Map([['England', '#4e79a7']]);

    const result = computeGlobeData(persons, families, geo, colors);

    assertEqual(result.pointsData.length, 2, '2 points (birth + death)');
    assertEqual(result.pointsData[0].type, 'birth', 'first point is birth');
    assertEqual(result.pointsData[1].type, 'death', 'second point is death');
    assertEqual(result.lifeArcsData.length, 1, '1 life arc');
    assertEqual(result.ancestorArcsData.length, 0, 'no ancestor arcs');
}

// Test 2: Person with same birth and death location
console.log('\n--- Birth + Death (same location) ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Jane Doe',
        birthPlace: 'London, England', deathPlace: 'London, England',
        country: 'England', generation: 0, familyChildId: null
    });

    const geo = new Map();
    geo.set('London, England', { lat: 51.5, lng: -0.12 });

    const result = computeGlobeData(persons, new Map(), geo, new Map());

    assertEqual(result.pointsData.length, 1, '1 point (same location → no death dot)');
    assertEqual(result.lifeArcsData.length, 0, 'no life arc (same location)');
}

// Test 3: Person with only birth place
console.log('\n--- Birth only ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Baby Smith',
        birthPlace: 'Berlin, Germany', deathPlace: null,
        country: 'Germany', generation: 0, familyChildId: null
    });

    const geo = new Map();
    geo.set('Berlin, Germany', { lat: 52.52, lng: 13.4 });

    const result = computeGlobeData(persons, new Map(), geo, new Map());

    assertEqual(result.pointsData.length, 1, '1 point (birth only)');
    assertEqual(result.lifeArcsData.length, 0, 'no life arc');
}

// Test 4: Person with no places — still placed at 0,0
console.log('\n--- No places (placed at 0,0) ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Unknown Person',
        birthPlace: null, deathPlace: null,
        country: null, generation: 0, familyChildId: null
    });

    const result = computeGlobeData(persons, new Map(), new Map(), new Map());

    assertEqual(result.pointsData.length, 1, '1 point at 0,0 (unknown location)');
    assert(result.pointsData[0].isUnknownLocation, 'marked as unknown location');
    assertEqual(result.pointsData[0].lat, 0, 'lat is 0');
    assertEqual(result.pointsData[0].lng, 0, 'lng is 0');
    assertEqual(result.lifeArcsData.length, 0, 'no life arcs');
    assertEqual(result.ancestorArcsData.length, 0, 'no ancestor arcs');
}

// Test 5: Ancestor connections
console.log('\n--- Ancestor connections ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Child',
        birthPlace: 'New York, USA', deathPlace: null,
        country: 'United States', generation: 0,
        familyChildId: 'F1'
    });
    persons.set('I2', {
        id: 'I2', name: 'Father',
        birthPlace: 'London, England', deathPlace: null,
        country: 'England', generation: 1,
        familyChildId: null
    });
    persons.set('I3', {
        id: 'I3', name: 'Mother',
        birthPlace: 'Paris, France', deathPlace: null,
        country: 'France', generation: 1,
        familyChildId: null
    });

    const families = new Map();
    families.set('F1', { id: 'F1', husbandId: 'I2', wifeId: 'I3', childIds: ['I1'] });

    const geo = new Map();
    geo.set('New York, USA', { lat: 40.71, lng: -74.0 });
    geo.set('London, England', { lat: 51.5, lng: -0.12 });
    geo.set('Paris, France', { lat: 48.85, lng: 2.35 });

    const result = computeGlobeData(persons, families, geo, new Map());

    assertEqual(result.ancestorArcsData.length, 2, '2 ancestor arcs (child → father, child → mother)');
    assertEqual(result.ancestorArcsData[0].parentId, 'I2', 'first arc to father');
    assertEqual(result.ancestorArcsData[1].parentId, 'I3', 'second arc to mother');
}

// Test 6: Ancestor at same location (no arc)
console.log('\n--- Ancestor at same location ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Child',
        birthPlace: 'London, England', deathPlace: null,
        country: 'England', generation: 0,
        familyChildId: 'F1'
    });
    persons.set('I2', {
        id: 'I2', name: 'Father',
        birthPlace: 'London, England', deathPlace: null,
        country: 'England', generation: 1,
        familyChildId: null
    });

    const families = new Map();
    families.set('F1', { id: 'F1', husbandId: 'I2', wifeId: null, childIds: ['I1'] });

    const geo = new Map();
    geo.set('London, England', { lat: 51.5, lng: -0.12 });

    const result = computeGlobeData(persons, families, geo, new Map());

    assertEqual(result.ancestorArcsData.length, 0, 'no ancestor arc when same location');
}

// Test 7: Place not geocoded — placed at 0,0 as unknown
console.log('\n--- Ungeocoded place (at 0,0) ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Lost Person',
        birthPlace: 'Unknown Village, Nowhere', deathPlace: null,
        country: null, generation: 0, familyChildId: null
    });

    const result = computeGlobeData(persons, new Map(), new Map(), new Map());

    assertEqual(result.pointsData.length, 1, '1 point at 0,0 for ungeocoded place');
    assert(result.pointsData[0].isUnknownLocation, 'marked as unknown');
    assertEqual(result.pointsData[0].lat, 0, 'placed at lat 0');
}

// Test 8: Multiple persons
console.log('\n--- Multiple persons ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Person A',
        birthPlace: 'London, England', deathPlace: 'Paris, France',
        country: 'England', generation: 0, familyChildId: null
    });
    persons.set('I2', {
        id: 'I2', name: 'Person B',
        birthPlace: 'Berlin, Germany', deathPlace: null,
        country: 'Germany', generation: 0, familyChildId: null
    });
    persons.set('I3', {
        id: 'I3', name: 'Person C',
        birthPlace: null, deathPlace: null,
        country: null, generation: 0, familyChildId: null
    });

    const geo = new Map();
    geo.set('London, England', { lat: 51.5, lng: -0.12 });
    geo.set('Paris, France', { lat: 48.85, lng: 2.35 });
    geo.set('Berlin, Germany', { lat: 52.52, lng: 13.4 });

    const result = computeGlobeData(persons, new Map(), geo, new Map());

    assertEqual(result.pointsData.length, 4, '4 points (A birth + A death + B birth + C at 0,0)');
    assertEqual(result.lifeArcsData.length, 1, '1 life arc (A only)');
    // Person C has no places but still gets a point at 0,0
    const cPoints = result.pointsData.filter(p => p.personId === 'I3');
    assertEqual(cPoints.length, 1, 'Person C gets 1 unknown-location point');
    assert(cPoints[0].isUnknownLocation, 'Person C point is marked unknown');
}

// Test 9: Ungeocoded death place gets point at 0,0
console.log('\n--- Ungeocoded death place ---');
{
    const persons = new Map();
    persons.set('I1', {
        id: 'I1', name: 'Person X',
        birthPlace: 'London, England', deathPlace: 'Unknown Town',
        country: 'England', generation: 0, familyChildId: null
    });

    const geo = new Map();
    geo.set('London, England', { lat: 51.5, lng: -0.12 });
    // 'Unknown Town' NOT in geo

    const result = computeGlobeData(persons, new Map(), geo, new Map());

    assertEqual(result.pointsData.length, 2, '2 points (birth known + death at 0,0)');
    assert(!result.pointsData[0].isUnknownLocation, 'birth is known location');
    assert(result.pointsData[1].isUnknownLocation, 'death is unknown location');
    assertEqual(result.pointsData[1].lat, 0, 'death placed at lat 0');
    assertEqual(result.lifeArcsData.length, 0, 'no life arc (death not geocoded)');
}

// Test 10: Correction tracking in geocoder
console.log('\n--- Geocoder correction tracking ---');
{
    localStorage.clear();
    const geo = new GeocodingService();

    // Initial save — null (failed lookup)
    geo._saveToCache('some place', null);
    assert(geo.hasNewEntries, 'new entry tracked');

    geo._newEntries = 0;

    // Correct to real coords
    geo._saveToCache('some place', { lat: 40, lng: -74 });
    assert(geo.hasNewEntries, 'correction from null tracked as new entry');

    geo._newEntries = 0;

    // Change coords
    geo._saveToCache('some place', { lat: 41, lng: -73 });
    assert(geo.hasNewEntries, 'coordinate change tracked as new entry');

    geo._newEntries = 0;

    // Same coords — no change
    geo._saveToCache('some place', { lat: 41, lng: -73 });
    assert(!geo.hasNewEntries, 'same coords not tracked as new entry');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
