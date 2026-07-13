// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import { splitLines } from './splitLines';

/**
 * Build a recipe object from form state fields.
 * Handles common parsing: trimming, splitting lines/tags, parsing numeric fields.
 *
 * @param {object} fields - Raw form state
 * @param {string} fields.title
 * @param {string} fields.ingredients - Newline-separated ingredient lines
 * @param {string} fields.steps - Newline-separated step lines
 * @param {string} fields.tags - Comma-separated tag string
 * @param {string|number} fields.prepMinutes - Prep time (minutes)
 * @param {string|number} fields.cookMinutes - Cook time (minutes)
 * @param {string|number} fields.servings
 * @param {string} [fields.description]
 * @param {string} [fields.imageUrl]
 * @param {string} [fields.notes]
 * @param {string} [fields.collection]
 * @returns {object} Parsed recipe object ready for API submission
 */
export const buildRecipeObject = ({
  title,
  description,
  ingredients,
  steps,
  tags,
  prepMinutes,
  cookMinutes,
  servings,
  imageUrl,
  notes,
  collection,
}) => ({
  title: title.trim(),
  ...(description != null ? { description: description.trim() } : {}),
  ingredients: splitLines(ingredients),
  steps: splitLines(steps),
  tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
  prep_minutes: parseInt(prepMinutes, 10) || 0,
  cook_minutes: parseInt(cookMinutes, 10) || 0,
  servings: parseInt(servings, 10) || 1,
  ...(imageUrl != null ? { image_url: imageUrl.trim() } : {}),
  ...(notes != null ? { notes: notes.trim() } : {}),
  ...(collection != null ? { collection: collection.trim() } : {}),
});
