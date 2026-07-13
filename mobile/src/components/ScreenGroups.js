// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import ErrorBoundary from './ErrorBoundary';

export function RecipeGroup({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export function MealPlanningGroup({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export function CookingGroup({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export function SettingsGroup({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
