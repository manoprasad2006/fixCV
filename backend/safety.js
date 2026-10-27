// FixCV hard-stop safety gate. Runs BEFORE any model call on user input,
// and AGAIN on model output. Never cut. New work, 2026-10-28.
//
// Categories: gas, mains electricity, fuel systems, structural load,
// vehicle brakes. Any match -> caller must show the stop screen in the
// user's language and must NOT generate repair steps.

const RULES = [
  {
    id: 'gas',
    // English, Tamil (transliterated + script), Hindi (transliterated + script)
    patterns: [
      /gas\b/i, /lpg/i, /cng/i, /png/i, /\bcylinder\b/i, /smell.*gas/i,
      /gas.*smell/i, /gas.*leak/i, /leak.*gas/i,
      /எரிவாயு/, /கேஸ்/, /சிலிண்டர்/,
      /गैस/, /सिलेंडर/, /रसोई\s*गैस/,
    ],
  },
  {
    id: 'electricity',
    patterns: [
      /electr/i, /mains/i, /high.?voltage/i, /exposed\s*wir/i, /live\s*wir/i,
      /short\s*circuit/i, /shock/i, /fuse\s*box/i, /breaker/i, /switchboard/i,
      /மின்சாரம்/, /கரண்ட்/, /வயர்/, /ஷாக்/,
      /बिजली/, /करंट/, /तार/, /बिजली\s*का\s*झटका/, /शॉक/,
    ],
  },
  {
    id: 'fuel',
    patterns: [
      /fuel/i, /petrol/i, /diesel/i, /kerosene/i, /\boil\b.*leak/i,
      /fuel.*leak/i, /leak.*fuel/i, /tank.*leak/i,
      /பெட்ரோல்/, /டீசல்/, /எரிபொருள்/,
      /पेट्रोल/, /डीजल/, /ईंधन/, /मिट्टी\s*का\s*तेल/,
    ],
  },
  {
    id: 'structural',
    patterns: [
      /load.?bearing/i, /structural/i, /beam/i, /column/i, /foundation/i,
      /wall\s*crack/i, /ceiling.*(crack|sag|collapse)/i, /roof.*collapse/i,
      /கட்டிடம்.*(விரிசல்|இடிவு)/, /சுவர்.*விரிசல்/, /உத்திரம்/,
      /दीवार.*दरार/, /छत.*(दरार|गिर)/, /बीम/, /नींव/,
    ],
  },
  {
    id: 'brakes',
    patterns: [
      /brake/i, /break\s*(pad|disc|fail)/i, /abs\b/i,
      /பிரேக்/,
      /ब्रेक/,
    ],
  },
  {
    id: 'medical',
    // FixCV never produces medical content; route to stop screen too.
    patterns: [
      /injur/i, /wound/i, /bleed/i, /burn\b/i, /medical/i, /doctor/i,
      /காயம்/, /ரத்தம்/,
      /चोट/, /घाव/, /खून/, /डॉक्टर/,
    ],
  },
];

/**
 * Check text against hard-stop rules.
 * @param {string} text user input or model output
 * @returns {{ stopped: boolean, category: string|null }} first matching category
 */
export function checkHardStop(text) {
  const hay = String(text ?? '');
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      // Reset stateful regexes (none use /g, but be safe)
      re.lastIndex = 0;
      if (re.test(hay)) return { stopped: true, category: rule.id };
    }
  }
  return { stopped: false, category: null };
}

/** Category ids, for tests and stop-screen lookup. */
export const CATEGORIES = RULES.map((r) => r.id);
