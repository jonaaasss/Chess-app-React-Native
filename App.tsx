import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ensureSeeded } from './src/storage';
import type { GroupId } from './src/types';
import { colors } from './src/theme';
import { OverlayHost } from './src/overlay';
import { HomeScreen } from './src/screens/HomeScreen';
import { RepertoiresScreen } from './src/screens/RepertoiresScreen';
import { OpeningsScreen } from './src/screens/OpeningsScreen';
import { CardsScreen } from './src/screens/CardsScreen';

type ViewState =
  | { name: 'home' }
  | { name: 'repertoires'; group: GroupId }
  | { name: 'openings'; repertoireId: string }
  | { name: 'cards'; openingId: string };

export default function App() {
  const [stack, setStack] = useState<ViewState[]>([{ name: 'home' }]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureSeeded().then(() => setReady(true));
  }, []);

  function push(v: ViewState) {
    setStack((s) => [...s, v]);
  }
  function pop() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }
  function goHome() {
    setStack([{ name: 'home' }]);
  }

  const view = stack[stack.length - 1];

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {!ready ? (
          <View style={{ flex: 1, backgroundColor: colors.bg }} />
        ) : (
          <>
            {view.name === 'home' && (
              <HomeScreen onOpenGroup={(group) => push({ name: 'repertoires', group })} />
            )}
            {view.name === 'repertoires' && (
              <RepertoiresScreen
                group={view.group}
                onBack={goHome}
                onOpenRepertoire={(repertoireId) => push({ name: 'openings', repertoireId })}
              />
            )}
            {view.name === 'openings' && (
              <OpeningsScreen
                repertoireId={view.repertoireId}
                onBack={pop}
                onOpenOpening={(openingId) => push({ name: 'cards', openingId })}
              />
            )}
            {view.name === 'cards' && <CardsScreen openingId={view.openingId} onBack={pop} />}
          </>
        )}
        <OverlayHost />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
