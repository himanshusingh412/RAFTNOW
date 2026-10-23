// Entry point. In this npm-workspaces monorepo `expo` is hoisted to the root
// node_modules, so "node_modules/expo/AppEntry.js" does not exist next to the app.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
