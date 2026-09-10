// ★ PRIMER import, y tiene que seguir siéndolo: instala Web Crypto en
// Hermes antes de que se evalúe cualquier módulo que pueda generar un id o
// un delimitador aleatorio. Ver `src/platform/webcrypto.ts` para por qué es
// un import y no un bloque de código acá.
import './src/platform/webcrypto.ts';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
