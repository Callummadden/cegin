# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Cegin Contributors
# This file is part of Cegin — https://github.com/Callummadden/cegin
#!/usr/bin/env python3
"""
Generate global aliases for USDA foods using pattern matching.
Covers UK, Australian, and Canadian terminology.
Run once: python3 server/generate-aliases.py
"""
import sqlite3
import os
import re

DB_PATH = os.path.expanduser('~/Projects/cegin/mobile/assets/usda-nutrition.db')

# ─── Static alias dictionary ────────────────────────────────────────────
# Maps USDA description patterns → aliases (comma-separated)
# Each entry: (pattern, aliases_to_add)
# Pattern is checked against LOWER(description)

ALIAS_RULES = [
    # ── Meats ─────────────────────────────────────────────────────────
    ('ground lamb', 'lamb mince,minced lamb'),
    ('ground beef', 'beef mince,minced beef,hamburger'),
    ('ground pork', 'pork mince,minced pork'),
    ('ground turkey', 'turkey mince,minced turkey'),
    ('ground chicken', 'chicken mince,minced chicken'),
    ('lamb, ground', 'lamb mince,minced lamb'),
    ('beef, ground', 'beef mince,minced beef,hamburger'),
    ('chicken breast', 'chicken fillet'),
    ('chicken thigh', 'chicken leg'),
    ('bacon', 'streaky bacon,back bacon,rashers'),
    ('ham', 'gammon'),
    ('pork chop', 'pork cutlet'),
    ('pork loin', 'pork fillet'),
    ('beef steak', 'beef fillet'),
    ('sirloin steak', 'sirloin'),
    ('ribeye', 'rib eye,rib-eye'),
    ('shrimp', 'prawns,king prawns'),
    ('salmon', 'salmon fillet'),
    ('cod', 'cod fillet'),
    ('haddock', 'haddock fillet'),
    ('tuna, canned', 'tinned tuna'),
    ('anchovy', 'anchovies'),

    # ── Produce ───────────────────────────────────────────────────────
    ('eggplant', 'aubergine'),
    ('zucchini', 'courgette'),
    ('arugula', 'rocket'),
    ('scallion', 'spring onion,spring onions,green onion'),
    ('cilantro', 'coriander,fresh coriander'),
    ('rutabaga', 'swede,neep'),
    ('snow pea', 'mangetout'),
    ('snap pea', 'mangetout'),
    ('bell pepper', 'peppers,capsicum'),
    ('bell pepper, red', 'red pepper,red capsicum'),
    ('bell pepper, green', 'green pepper,green capsicum'),
    ('bell pepper, yellow', 'yellow pepper,yellow capsicum'),
    ('sweet corn', 'sweetcorn,corn on the cob'),
    ('corn, sweet', 'sweetcorn'),
    ('garbanzo bean', 'chickpea,chickpeas'),
    ('fava bean', 'broad bean,broad beans'),
    ('lima bean', 'butter bean,butter beans'),
    ('potato, raw', 'spuds,tatties'),
    ('sweet potato', 'sweet potatoes'),
    ('tomato, raw', 'tomatoes,tomato'),
    ('onion, raw', 'onions'),
    ('carrot, raw', 'carrots'),
    ('celery, raw', 'celery stalk'),
    ('mushroom', 'mushrooms'),
    ('avocado', 'avocados'),
    ('spinach, raw', 'baby spinach'),
    ('kale, raw', 'kale leaves'),
    ('lettuce', 'salad leaves'),
    ('broccoli, raw', 'broccoli florets'),
    ('cauliflower', 'cauliflower florets'),
    ('cabbage', 'cabbage,white cabbage,green cabbage'),
    ('beetroot', 'beets,beet'),
    ('parsnip', 'parsnips'),
    ('turnip', 'turnips'),
    ('leek', 'leeks'),
    ('asparagus', 'asparagus spears'),
    ('artichoke', 'artichokes'),
    ('okra', 'lady finger,ladies fingers'),
    ('pomegranate', 'pomegranate seeds'),
    ('raisin', 'sultanas,raisins'),
    ('currant', 'currants'),
    ('sultana', 'sultanas,raisins'),
    ('date', 'dates,medjool dates'),
    ('fig', 'figs'),
    ('prune', 'prunes'),
    ('cranberry', 'cranberries'),
    ('blueberry', 'blueberries'),
    ('raspberry', 'raspberries'),
    ('blackberry', 'blackberries'),
    ('strawberry', 'strawberries'),
    ('gooseberry', 'gooseberries'),
    ('elderberry', 'elderberries'),
    ('lychee', 'lychees,lichee'),
    ('passion fruit', 'passionfruit'),
    ('dragon fruit', 'pitaya'),
    ('papaya', 'pawpaw'),

    # ── Dairy ─────────────────────────────────────────────────────────
    ('heavy cream', 'double cream,whipping cream'),
    ('light cream', 'single cream,pouring cream'),
    ('half and half', 'half-and-half'),
    ('sour cream', 'creme fraiche'),
    ('cottage cheese', 'curd cheese'),
    ('cream cheese', 'soft cheese'),
    ('yogurt, plain', 'natural yoghurt,plain yogurt,natural yogurt'),
    ('yogurt, greek', 'greek yoghurt,greek yogurt'),
    ('buttermilk', 'buttermilk'),
    ('whey', 'whey protein'),
    ('egg, whole', 'eggs,free range eggs'),
    ('butter, salted', 'butter'),
    ('butter, unsalted', 'unsalted butter'),
    ('margarine', 'marge'),
    ('ghee', 'clarified butter'),

    # ── Grains & Baking ───────────────────────────────────────────────
    ('all-purpose flour', 'plain flour,plain flour,AP flour'),
    ('bread flour', 'strong flour,strong bread flour'),
    ('whole wheat flour', 'wholemeal flour,whole grain flour'),
    ('self-rising flour', 'self-raising flour'),
    ('cake flour', 'sponge flour'),
    ('cornstarch', 'cornflour,corn starch'),
    ('baking soda', 'bicarbonate of soda,bicarb,baking bicarb'),
    ('baking powder', 'raising agent'),
    ('powdered sugar', 'icing sugar,confectioners sugar'),
    ('superfine sugar', 'caster sugar,castor sugar'),
    ('raw sugar', 'demerara sugar,turbinado sugar'),
    ('brown sugar', 'light brown sugar,muscovado sugar'),
    ('molasses', 'black treacle'),
    ('corn syrup', 'golden syrup'),
    ('maple syrup', 'maple'),
    ('oats, regular', 'porridge oats,rolled oats,quick oats'),
    ('oats, steel cut', 'pinhead oatmeal,steel-cut oats'),
    ('rice, white', 'white rice'),
    ('rice, brown', 'brown rice,whole grain rice'),
    ('basmati rice', 'basmati'),
    ('jasmine rice', 'jasmine'),
    ('quinoa', 'quinoa grain'),
    ('couscous', 'cous cous'),
    ('bulgur', 'bulgur wheat'),
    ('breadcrumbs', 'bread crumbs'),
    ('panko', 'panko breadcrumbs'),
    ('pasta, cooked', 'pasta,noodles'),
    ('spaghetti', 'spaghetti pasta'),
    ('penne', 'penne pasta'),
    ('macaroni', 'mac'),
    ('lasagna', 'lasagne'),
    ('bread, white', 'white bread,sliced bread'),
    ('bread, whole wheat', 'wholemeal bread,whole grain bread'),
    ('tortilla', 'wrap,flour tortilla'),
    ('pita', 'pitta,pitta bread'),
    ('bagel', 'bagels'),
    ('croissant', 'croissants'),
    ('muffin', 'muffins'),
    ('cracker', 'crackers'),
    ('granola', 'muesli'),
    ('cereal', 'breakfast cereal'),

    # ── Herbs & Spices ────────────────────────────────────────────────
    ('italian seasoning', 'mixed herbs,dried herbs'),
    ('garlic powder', 'garlic granules,ground garlic'),
    ('onion powder', 'onion granules,ground onion'),
    ('paprika', 'smoked paprika,sweet paprika'),
    ('chili powder', 'chilli powder'),
    ('cayenne', 'cayenne pepper'),
    ('cumin', 'ground cumin,jeera'),
    ('coriander seed', 'ground coriander'),
    ('turmeric', 'ground turmeric'),
    ('cinnamon', 'ground cinnamon'),
    ('nutmeg', 'ground nutmeg'),
    ('ginger, ground', 'ground ginger'),
    ('mustard', 'english mustard,dijon mustard'),
    ('horseradish', 'horseradish sauce'),
    ('vinegar, white', 'white vinegar,distilled vinegar'),
    ('vinegar, apple cider', 'cider vinegar'),
    ('soy sauce', 'soya sauce'),
    ('worcestershire', 'worcester sauce'),
    ('hot sauce', 'chilli sauce,tabasco'),
    ('ketchup', 'tomato sauce,tomato ketchup'),
    ('mayonnaise', 'mayo'),
    ('peanut butter', 'peanut paste'),
    ('jam', 'jelly,preserve'),
    ('marmalade', 'orange marmalade'),
    ('vegemite', 'marmite'),

    # ── Canned/Jarred ─────────────────────────────────────────────────
    ('tomato puree', 'passata,tomato paste'),
    ('diced tomato', 'chopped tomato,tinned tomatoes'),
    ('tomato sauce', 'marinara,pasta sauce'),
    ('coconut milk', 'coconut cream'),
    ('coconut oil', 'coconut cooking oil'),
    ('olive oil', 'extra virgin olive oil,EVOO'),
    ('vegetable oil', 'cooking oil,sunflower oil'),
    ('canola oil', 'rapeseed oil'),
    ('chicken broth', 'chicken stock'),
    ('beef broth', 'beef stock'),
    ('vegetable broth', 'vegetable stock'),
    ('stock cube', 'bouillon cube'),

    # ── Fish & Seafood ────────────────────────────────────────────────
    ('fish, cod', 'cod fillet,cod loin'),
    ('fish, salmon', 'salmon fillet,salmon steak'),
    ('fish, tuna', 'tuna steak,tuna fillet'),
    ('fish, haddock', 'haddock fillet,smoked haddock'),
    ('fish, mackerel', 'mackerel fillet'),
    ('fish, sardine', 'sardines'),
    ('fish, trout', 'trout fillet,rainbow trout'),
    ('fish, bass', 'sea bass'),
    ('crab', 'crab meat'),
    ('lobster', 'lobster tail'),
    ('mussel', 'mussels'),
    ('clam', 'clams'),
    ('scallop', 'scallops'),
    ('squid', 'calamari'),
    ('octopus', 'octopus'),

    # ── Nuts & Seeds ──────────────────────────────────────────────────
    ('walnut', 'walnuts'),
    ('almond', 'almonds,ground almonds,flaked almonds'),
    ('cashew', 'cashews,cashew nut'),
    ('pecan', 'pecans'),
    ('pistachio', 'pistachios'),
    ('hazelnut', 'hazelnuts'),
    ('macadamia', 'macadamia nuts'),
    ('brazil nut', 'brazil nuts'),
    ('pine nut', 'pine nuts,pignoli'),
    ('sesame seed', 'sesame seeds'),
    ('sunflower seed', 'sunflower seeds'),
    ('pumpkin seed', 'pumpkin seeds,pepitas'),
    ('flax seed', 'linseed,flaxseed'),
    ('chia seed', 'chia seeds'),
    ('hemp seed', 'hemp hearts'),
    ('coconut, shredded', 'desiccated coconut,shredded coconut'),
]

# ─── Main logic ─────────────────────────────────────────────────────────

def add_aliases_column(conn):
    """Add aliases column to foods table if not exists."""
    c = conn.cursor()
    try:
        c.execute('ALTER TABLE foods ADD COLUMN aliases TEXT DEFAULT ""')
        print('Added aliases column to foods table')
    except Exception as e:
        if 'duplicate column' in str(e).lower():
            print('aliases column already exists')
        else:
            raise


def rebuild_fts(conn):
    """Rebuild FTS5 index to include aliases."""
    c = conn.cursor()
    c.execute('DROP TABLE IF EXISTS foods_fts')
    c.execute('''CREATE VIRTUAL TABLE foods_fts USING fts5(
        description, aliases, content='foods', content_rowid='fdc_id'
    )''')
    c.execute("INSERT INTO foods_fts(rowid, description, aliases) SELECT fdc_id, description, COALESCE(aliases, '') FROM foods")
    print('Rebuilt FTS5 index with aliases')


def generate_aliases(conn):
    """Apply pattern matching rules to generate aliases."""
    c = conn.cursor()
    c.execute('SELECT fdc_id, description, COALESCE(aliases, "") FROM foods')
    foods = c.fetchall()

    updated = 0
    total_aliases = 0

    for fdc_id, description, existing in foods:
        desc_lower = description.lower()
        new_aliases = set()

        for pattern, aliases_str in ALIAS_RULES:
            if pattern.lower() in desc_lower:
                for alias in aliases_str.split(','):
                    alias = alias.strip()
                    if alias and alias.lower() != desc_lower:
                        new_aliases.add(alias)

        if new_aliases and not existing:
            alias_text = ','.join(sorted(new_aliases))
            c.execute('UPDATE foods SET aliases = ? WHERE fdc_id = ?', (alias_text, fdc_id))
            updated += 1
            total_aliases += len(new_aliases)

    conn.commit()
    print(f'Generated aliases for {updated} foods ({total_aliases} total aliases)')


def verify(conn):
    """Show sample aliases and stats."""
    c = conn.cursor()

    c.execute('SELECT COUNT(*) FROM foods WHERE aliases != "" AND aliases IS NOT NULL')
    count = c.fetchone()[0]
    print(f'\nFoods with aliases: {count}')

    c.execute('SELECT description, aliases FROM foods WHERE aliases != "" ORDER BY RANDOM() LIMIT 10')
    print('\nSample aliases:')
    for desc, aliases in c.fetchall():
        print(f'  {desc[:40]:40} -> {aliases}')

    # Show UK-specific matches
    print('\nUK term lookups:')
    for term in ['lamb mince', 'courgette', 'aubergine', 'rocket', 'plain flour', 'spring onion', 'prawns', 'coriander']:
        c.execute(f"SELECT description FROM foods_fts WHERE foods_fts MATCH 'aliases : {term}' LIMIT 1")
        row = c.fetchone()
        if row:
            print(f'  {term:20} -> {row[0][:50]}')
        else:
            # Try description
            c.execute(f"SELECT description FROM foods_fts WHERE foods_fts MATCH 'description : {term}' LIMIT 1")
            row = c.fetchone()
            print(f'  {term:20} -> {row[0][:50] if row else "NO MATCH"}')


if __name__ == '__main__':
    conn = sqlite3.connect(DB_PATH)
    add_aliases_column(conn)
    generate_aliases(conn)
    rebuild_fts(conn)
    verify(conn)

    import os
    print(f'\nDB size: {os.path.getsize(DB_PATH)/1024/1024:.1f} MB')
    conn.close()
