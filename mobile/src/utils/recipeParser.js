/**
 * recipeParser.js
 * Parses raw OCR text into structured recipe fields.
 * Lenient — recipe formats vary wildly, so we try many patterns.
 */

// ── Helpers ──────────────────────────────────────────────────────────────

const SECTION_HEADERS = [
  /^ingredients?\s*:?\s*$/i,
  /^instructions?\s*:?\s*$/i,
  /^directions?\s*:?\s*$/i,
  /^steps?\s*:?\s*$/i,
  /^method\s*:?\s*$/i,
  /^preparation\s*:?\s*$/i,
  /^you\s+will\s+need\s*:?\s*$/i,
  /^what\s+you\s+need\s*:?\s*$/i,
  /^how\s+to\s+(make|cook|prepare)\s*:?\s*$/i,
  /^notes?\s*:?\s*$/i,
  /^equipment\s*:?\s*$/i,
  /^nutrition\s*:?\s*$/i,
];

function isSectionHeader(line) {
  const trimmed = line.trim();
  return SECTION_HEADERS.some((re) => re.test(trimmed));
}

function isIngredientsHeader(line) {
  return /^(ingredients?|you\s+will\s+need|what\s+you\s+need)\s*:?\s*$/i.test(line.trim());
}

function isInstructionsHeader(line) {
  return /^(instructions?|directions?|steps?|method|how\s+to\s+(make|cook|prepare))\s*:?\s*$/i.test(line.trim());
}

function isBulletLine(line) {
  return /^\s*[-•*–—]\s+/.test(line);
}

function isNumberedLine(line) {
  return /^\s*\d{1,3}[.)]\s+/.test(line);
}

function stripBullet(line) {
  return line.replace(/^\s*[-•*–—]\s+/, '').replace(/^\s*\d{1,3}[.)]\s+/, '').trim();
}

// ── Time extraction ──────────────────────────────────────────────────────

function extractTime(text) {
  // Match patterns like "30 min", "1 hour", "1h 30m", "45 minutes", "1.5 hours"
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)?\s*(?:minutes?|mins?|m)?/i,
    /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const hours = parseFloat(m[1]) || 0;
      const mins = m[2] ? parseInt(m[2], 10) : (hours >= 1 && text.match(/hour|hr/i) ? 0 : hours);
      if (text.match(/hour|hr/i)) {
        return Math.round(hours * 60 + (parseInt(m[2], 10) || 0));
      }
      return Math.round(mins);
    }
  }
  return null;
}

function extractServings(text) {
  const patterns = [
    /serves?\s+(\d+(?:\s*[-–—]\s*\d+)?)/i,
    /(\d+(?:\s*[-–—]\s*\d+)?)\s+servings?/i,
    /makes?\s+(\d+(?:\s*[-–—]\s*\d+)?)/i,
    /yield[s]?\s*:?\s*(\d+(?:\s*[-–—]\s*\d+)?)/i,
    /(\d+(?:\s*[-–—]\s*\d+)?)\s+portions?/i,
    /^\s*(\d+(?:\s*[-–—]\s*\d+)?)\s*$/,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      // If range like "4-6", take the first number
      const num = parseInt(m[1], 10);
      return isNaN(num) ? null : num;
    }
  }
  return null;
}

// ── Main parser ──────────────────────────────────────────────────────────

export function parseRecipeText(text) {
  if (!text || !text.trim()) {
    return { title: '', ingredients: [], instructions: [], prepTime: '', cookTime: '', servings: '', tags: [] };
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let title = '';
  let ingredients = [];
  let instructions = [];
  let prepTime = '';
  let cookTime = '';
  let servings = '';
  let tags = [];

  // ── Phase 1: Detect sections ─────────────────────────────────────────

  let currentSection = 'title'; // 'title' | 'ingredients' | 'instructions'
  let titleFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section headers
    if (isIngredientsHeader(line)) {
      currentSection = 'ingredients';
      titleFound = true;
      continue;
    }
    if (isInstructionsHeader(line)) {
      currentSection = 'instructions';
      titleFound = true;
      continue;
    }
    if (isSectionHeader(line)) {
      // Some other section header (notes, nutrition, etc.) — skip until we find something useful
      titleFound = true;
      continue;
    }

    // ── Title detection ────────────────────────────────────────────────
    if (currentSection === 'title' && !titleFound) {
      // Skip very short lines that might be page numbers or artifacts
      if (line.length < 3 && !isBulletLine(line) && !isNumberedLine(line)) continue;
      // Skip lines that look like metadata (times, servings at the top)
      if (extractTime(line) !== null && line.length < 30) {
        // Might be a time line near the top — capture it
        const t = extractTime(line);
        if (!prepTime) prepTime = String(t);
        continue;
      }
      if (extractServings(line) !== null && line.length < 30) {
        servings = String(extractServings(line));
        continue;
      }
      // First substantial line is likely the title
      title = line;
      titleFound = true;
      currentSection = 'title'; // stay in title section to capture more metadata
      continue;
    }

    // After title but before ingredients/instructions: look for metadata
    if (currentSection === 'title' && titleFound) {
      // Look for prep/cook time patterns
      const prepMatch = line.match(/prep(?:\s+time)?\s*:?\s*(.+)/i);
      const cookMatch = line.match(/cook(?:\s+time)?\s*:?\s*(.+)/i);
      const totalMatch = line.match(/total\s+time\s*:?\s*(.+)/i);
      const servMatch = line.match(/(?:serves?|servings?|yield)\s*:?\s*(.+)/i);

      if (prepMatch) {
        const t = extractTime(prepMatch[1]);
        if (t) prepTime = String(t);
        continue;
      }
      if (cookMatch) {
        const t = extractTime(cookMatch[1]);
        if (t) cookTime = String(t);
        continue;
      }
      if (totalMatch) {
        const t = extractTime(totalMatch[1]);
        if (t && !prepTime && !cookTime) {
          // If we only have total, estimate prep=total/3, cook=2*total/3
          const total = t;
          prepTime = String(Math.round(total / 3));
          cookTime = String(Math.round((total * 2) / 3));
        }
        continue;
      }
      if (servMatch) {
        const s = extractServings(servMatch[1]);
        if (s) servings = String(s);
        continue;
      }

      // Check if line has time info
      const t = extractTime(line);
      if (t !== null && line.length < 40) {
        if (!prepTime) prepTime = String(t);
        else if (!cookTime) cookTime = String(t);
        continue;
      }

      // Check for servings
      const sv = extractServings(line);
      if (sv !== null && line.length < 30) {
        servings = String(sv);
        continue;
      }

      // If we hit something that looks like a list, switch to ingredients
      if (isBulletLine(line) || isNumberedLine(line)) {
        currentSection = 'ingredients';
        ingredients.push(stripBullet(line));
        continue;
      }

      // Otherwise keep accumulating title info (subtitle, description)
      // Don't overwrite title, just skip
      continue;
    }

    // ── Ingredients section ────────────────────────────────────────────
    if (currentSection === 'ingredients') {
      // If it looks like a numbered instruction, switch to instructions
      if (isNumberedLine(line) && ingredients.length > 2) {
        currentSection = 'instructions';
        instructions.push(stripBullet(line));
        continue;
      }
      ingredients.push(stripBullet(line));
      continue;
    }

    // ── Instructions section ───────────────────────────────────────────
    if (currentSection === 'instructions') {
      instructions.push(stripBullet(line));
      continue;
    }
  }

  // ── Phase 2: Fallback — if we got nothing, try to guess from bullet patterns ──
  if (ingredients.length === 0 && instructions.length === 0) {
    const bullets = lines.filter((l) => isBulletLine(l) || isNumberedLine(l));
    if (bullets.length > 0) {
      // Split bullets: shorter ones are likely ingredients, longer ones are steps
      const shortBullets = bullets.filter((b) => stripBullet(b).length < 60);
      const longBullets = bullets.filter((b) => stripBullet(b).length >= 60);

      if (shortBullets.length > 0 && longBullets.length > 0) {
        ingredients = shortBullets.map(stripBullet);
        instructions = longBullets.map(stripBullet);
      } else {
        // All bullets — assume ingredients if short, instructions if long
        const avgLen = bullets.reduce((sum, b) => sum + stripBullet(b).length, 0) / bullets.length;
        if (avgLen < 50) {
          ingredients = bullets.map(stripBullet);
        } else {
          instructions = bullets.map(stripBullet);
        }
      }
    }
  }

  // ── Phase 3: If still no title, use first line ─────────────────────
  if (!title && lines.length > 0) {
    title = lines[0];
  }

  // Clean up title — remove leading numbers, bullets, etc.
  title = title.replace(/^\d+[.)]\s*/, '').replace(/^[-•*–—]\s+/, '').trim();

  return {
    title,
    ingredients,
    instructions,
    prepTime,
    cookTime,
    servings,
    tags,
  };
}
