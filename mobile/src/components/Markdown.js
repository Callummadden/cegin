// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { Text, View } from 'react-native';
import { MONO } from '../theme';

// Lightweight markdown renderer for chat bubbles.
// Handles: **bold**, *italic*, # headers, - lists, `code`, ```code blocks```

function parseInline(text, baseStyle, colors) {
  if (!text) return [null];
  const parts = [];
  // Match **bold**, *italic*, `code`
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={last}>{text.slice(last, m.index)}</Text>);
    if (m[2]) parts.push(<Text key={m.index} style={{ fontWeight: '700' }}>{m[2]}</Text>);
    else if (m[3]) parts.push(<Text key={m.index} style={{ fontStyle: 'italic' }}>{m[3]}</Text>);
    else if (m[4]) parts.push(<Text key={m.index} style={{ fontFamily: MONO, fontSize: 12.5, backgroundColor: colors?.surface2 || 'rgba(255,255,255,0.08)', paddingHorizontal: 3, borderRadius: 3 }}>{m[4]}</Text>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Text key={last}>{text.slice(last)}</Text>);
  return parts.length ? parts : [null];
}

export default function Markdown({ children, colors }) {
  if (!children) return null;
  if (typeof children !== 'string') return <Text>{children}</Text>;
  const lines = children.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      elements.push(
        <View key={`code-${i}`} style={{ backgroundColor: colors?.surface || 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 10, marginVertical: 6 }}>
          <Text style={{ fontFamily: MONO, fontSize: 12.5, color: colors?.text || '#F6F1EA', lineHeight: 18 }}>
            {codeLines.join('\n')}
          </Text>
        </View>
      );
      continue;
    }

    // Header
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes = { 1: 19, 2: 16, 3: 14 };
      elements.push(
        <Text key={`h-${i}`} style={{ fontSize: sizes[level], fontWeight: '900', color: colors?.text || '#F6F1EA', marginTop: 8, marginBottom: 4 }}>
          {headerMatch[2]}
        </Text>
      );
      i++;
      continue;
    }

    // Bullet list
    const bulletMatch = line.match(/^(\s*)[-*•]\s+(.+)/);
    if (bulletMatch) {
      elements.push(
        <View key={`li-${i}`} style={{ flexDirection: 'row', marginVertical: 2, paddingLeft: 8 }}>
          <Text style={{ color: colors?.primary || '#FF5A26', marginRight: 6, marginTop: 1 }}>•</Text>
          <Text style={{ flex: 1, color: colors?.text2 || '#E2D9CF', fontSize: 14, lineHeight: 21 }}>
            {parseInline(bulletMatch[2], { color: colors?.text2 || '#E2D9CF' }, colors)}
          </Text>
        </View>
      );
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <View key={`ol-${i}`} style={{ flexDirection: 'row', marginVertical: 2, paddingLeft: 8 }}>
          <Text style={{ color: colors?.primary || '#FF5A26', marginRight: 6, marginTop: 1, fontWeight: '600', fontSize: 13 }}>{numMatch[2]}.</Text>
          <Text style={{ flex: 1, color: colors?.text2 || '#E2D9CF', fontSize: 14, lineHeight: 21 }}>
            {parseInline(numMatch[3], { color: colors?.text2 || '#E2D9CF' }, colors)}
          </Text>
        </View>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(
        <View key={`hr-${i}`} style={{ backgroundColor: colors?.border || '#2E2724', height: 1, marginVertical: 10 }} />
      );
      i++;
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<View key={`br-${i}`} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={`p-${i}`} style={{ color: colors?.text2 || '#E2D9CF', fontSize: 14, lineHeight: 21, marginVertical: 2 }}>
        {parseInline(line, { color: colors?.text2 || '#E2D9CF' }, colors)}
      </Text>
    );
    i++;
  }

  return <>{elements}</>;
}
