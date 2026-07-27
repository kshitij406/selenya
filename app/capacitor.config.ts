import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.lunara.mobile',
  appName: 'Selenya',
  webDir: 'dist',
  backgroundColor: '#FFFDF9',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scrollEnabled: true,
  },
  android: {
    backgroundColor: '#FFFDF9',
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#FFFDF9',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FFFDF9',
      overlaysWebView: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_lunara',
      iconColor: '#f35f7f',
    },
  },
}

export default config
