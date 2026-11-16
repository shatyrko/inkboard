import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './typefaces.css';
import { vContext } from './lib/contextmenu';

const app = createApp(App);
app.directive('context', vContext);
app.mount('#app');
