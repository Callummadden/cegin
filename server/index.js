const express = require('express');
const {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} = require('./db');

const app = express();
app.use(express.json());

// Health check — the app uses this to test the connection in Settings
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/recipes', (req, res) => {
  res.json(listRecipes(req.query.search));
});

app.get('/api/recipes/:id', (req, res) => {
  const recipe = getRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  res.json(recipe);
});

app.post('/api/recipes', (req, res) => {
  if (!req.body.title || !req.body.title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  res.status(201).json(createRecipe(req.body));
});

app.put('/api/recipes/:id', (req, res) => {
  const recipe = updateRecipe(req.params.id, req.body);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  res.json(recipe);
});

app.delete('/api/recipes/:id', (req, res) => {
  if (!deleteRecipe(req.params.id)) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 so the phone can reach it over the LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Recipe server listening on http://0.0.0.0:${PORT}`);
});
