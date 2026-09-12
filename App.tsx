import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold
} from '@expo-google-fonts/inter';
import { ensureSeeded, resolveGroupEntry } from './src/storage';
import type { GroupId } from './src/types';
import { colors } from './src/theme';
import { OverlayHost } from './src/overlay';
import { HomeScreen } from './src/screens/HomeScreen';
import { RepertoiresScreen } from './src/screens/RepertoiresScreen';
import { OpeningsScreen } from './src/screens/OpeningsScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

// One param list shared by the native stack — each screen still receives
// plain callback props (via the wrappers below) so the screen components
// themselves stay untouched; only this file knows about navigation.
type RootStackParamList = {
  Home: undefined;
  Repertoires: { group: GroupId };
  Openings: { repertoireId: string };
  Cards: { openingId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

SplashScreen.preventAutoHideAsync().catch(() => {});

function HomeRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return (
    <HomeScreen
      onOpenGroup={async (group) => {
        // Almost nobody uses more than one repertoire per side, so skip
        // straight to the one they have unless there's genuinely a choice
        // to make (2+ repertoires, or the user asked to always see the list).
        const { skipToRepertoireId } = await resolveGroupEntry(group);
        if (skipToRepertoireId) {
          navigation.navigate('Openings', { repertoireId: skipToRepertoireId });
        } else {
          navigation.navigate('Repertoires', { group });
        }
      }}
      onOpenSettings={() => navigation.navigate('Settings')}
    />
  );
}

function RepertoiresRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Repertoires'>) {
  return (
    <RepertoiresScreen
      group={route.params.group}
      onBack={() => navigation.goBack()}
      onOpenRepertoire={(repertoireId) => navigation.navigate('Openings', { repertoireId })}
    />
  );
}

function OpeningsRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Openings'>) {
  return (
    <OpeningsScreen
      repertoireId={route.params.repertoireId}
      onBack={() => navigation.goBack()}
      onOpenOpening={(openingId) => navigation.navigate('Cards', { openingId })}
    />
  );
}

function CardsRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Cards'>) {
  return <CardsScreen openingId={route.params.openingId} onBack={() => navigation.goBack()} />;
}

function SettingsRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Settings'>) {
  return <SettingsScreen onBack={() => navigation.goBack()} />;
}

export default function App() {
  const [dataReady, setDataReady] = useState(false);
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold
  });
  const ready = dataReady && fontsLoaded;

  useEffect(() => {
    ensureSeeded().then(() => setDataReady(true));
  }, []);

  const onLayoutRootView = useCallback(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayoutRootView}>
        <StatusBar style="light" />
        {!ready ? (
          <View style={{ flex: 1, backgroundColor: colors.bg }} />
        ) : (
          <NavigationContainer
            theme={{
              dark: true,
              colors: {
                primary: colors.primary,
                background: colors.bg,
                card: colors.bg,
                text: colors.textPrimary,
                border: colors.border,
                notification: colors.danger
              },
              fonts: {
                regular: { fontFamily: 'System', fontWeight: '400' },
                medium: { fontFamily: 'System', fontWeight: '500' },
                bold: { fontFamily: 'System', fontWeight: '700' },
                heavy: { fontFamily: 'System', fontWeight: '800' }
              }
            }}
          >
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                // Native slide-from-right-to-left push (and its mirrored pop)
                // on both platforms, using each OS's real screen-transition
                // APIs rather than a hand-rolled Animated timing.
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: colors.bg }
              }}
            >
              <Stack.Screen name="Home" component={HomeRoute} />
              <Stack.Screen name="Repertoires" component={RepertoiresRoute} />
              <Stack.Screen name="Openings" component={OpeningsRoute} />
              <Stack.Screen name="Cards" component={CardsRoute} />
              <Stack.Screen name="Settings" component={SettingsRoute} />
            </Stack.Navigator>
          </NavigationContainer>
        )}
        <OverlayHost />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
