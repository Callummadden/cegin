import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function AppModal({ visible, title, message, buttons, colors, onClose }) {
  if (!visible) return null;
  const isLong = message && message.length > 200;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }, isLong && { maxWidth: 400 }]}>
          <Text style={[s.title, { color: colors.text }]}>{title}</Text>
          {!!message && (
            isLong ? (
              <Text style={[s.messageLong, { color: colors.textMuted }]}>{message}</Text>
            ) : (
              <Text style={[s.message, { color: colors.textMuted }]}>{message}</Text>
            )
          )}
          <View style={s.buttons}>
            {buttons.map((btn, i) => (
              <Pressable
                key={i}
                style={[
                  s.btn,
                  { borderColor: colors.border },
                  btn.destructive && { borderColor: colors.danger },
                  btn.filled && { backgroundColor: colors.primary, borderColor: colors.primary },
                  btn.destructive && btn.filled && { backgroundColor: colors.danger, borderColor: colors.danger },
                ]}
                onPress={() => { onClose?.(); setTimeout(() => btn.onPress?.(), 0); }}
              >
                <Text style={[
                  s.btnText,
                  { color: colors.text2 },
                  btn.destructive && { color: colors.danger },
                  btn.filled && { color: colors.onPrimary },
                  btn.primary && { color: colors.primary },
                ]}>
                  {btn.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderWidth: 1.5,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
  },
  messageLong: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 22,
  },
  buttons: {
    width: '100%',
    gap: 10,
  },
  btn: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: {
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
});
