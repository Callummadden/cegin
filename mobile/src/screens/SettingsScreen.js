import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, getServerUrl, setServerUrl } from '../api';
import { colors } from '../theme';

export default function SettingsScreen() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null); // { ok: boolean, message: string }
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getServerUrl().then(setUrl);
  }, []);

  const saveAndTest = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
      setStatus({ ok: false, message: 'Enter a server URL first.' });
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      await setServerUrl(trimmed);
      setUrl(trimmed);
      await api.health();
      setStatus({ ok: true, message: 'Connected! Server is reachable.' });
    } catch (e) {
      setStatus({ ok: false, message: `Saved, but could not connect: ${e.message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Server URL</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.50:3000"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.hint}>
        The address of your recipe server on the local network, including the port.
      </Text>

      <Pressable
        style={[styles.button, testing && styles.buttonDisabled]}
        onPress={saveAndTest}
        disabled={testing}
      >
        <Text style={styles.buttonText}>{testing ? 'Testing…' : 'Save & test connection'}</Text>
      </Pressable>

      {status && (
        <Text style={[styles.status, status.ok ? styles.statusOk : styles.statusError]}>
          {status.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 8, lineHeight: 18 },
  button: {
    marginTop: 20,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  status: { marginTop: 16, fontSize: 15, lineHeight: 21 },
  statusOk: { color: '#2e7d32' },
  statusError: { color: colors.danger },
});
