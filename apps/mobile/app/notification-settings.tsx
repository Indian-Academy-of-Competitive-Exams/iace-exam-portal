/// <reference types="nativewind/types" />
import { Linking, ScrollView, View } from 'react-native';
import { Alert } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { Text } from '../src/components/ui/text';

/** Push is the phone's own permission, so this screen points at where it is switched. */
export default function NotificationSettingsScreen() {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <Alert variant="info">
        Every result, test and notice lands in the bell, which stays on for everyone. SMS carries
        your sign-in codes whatever you choose here.
      </Alert>

      <View className="gap-3">
        <Text variant="section">Push notifications</Text>
        <Card className="flex-row items-center justify-between gap-3 p-4">
          <Text className="flex-1 text-base text-foreground">This phone</Text>
          <Button variant="outline" size="sm" onPress={() => void Linking.openSettings()}>
            Phone settings
          </Button>
        </Card>
      </View>
    </ScrollView>
  );
}
