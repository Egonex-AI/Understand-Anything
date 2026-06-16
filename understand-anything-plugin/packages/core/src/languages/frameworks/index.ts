import type { FrameworkConfig } from "../types.js";

import { djangoConfig } from "./django.js";
import { fastapiConfig } from "./fastapi.js";
import { flaskConfig } from "./flask.js";
import { reactConfig } from "./react.js";
import { nextjsConfig } from "./nextjs.js";
import { expressConfig } from "./express.js";
import { vueConfig } from "./vue.js";
import { springConfig } from "./spring.js";
import { railsConfig } from "./rails.js";
import { ginConfig } from "./gin.js";
import { hiltConfig } from "./hilt.js";
import { nuxtConfig } from "./nuxt.js";
import { svelteConfig } from "./svelte.js";
import { angularConfig } from "./angular.js";

export const builtinFrameworkConfigs: FrameworkConfig[] = [
  djangoConfig,
  fastapiConfig,
  flaskConfig,
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
  springConfig,
  railsConfig,
  ginConfig,
  hiltConfig,
  nuxtConfig,
  svelteConfig,
  angularConfig,
];

export {
  djangoConfig,
  fastapiConfig,
  flaskConfig,
  reactConfig,
  nextjsConfig,
  expressConfig,
  vueConfig,
  springConfig,
  railsConfig,
  ginConfig,
  hiltConfig,
  nuxtConfig,
  svelteConfig,
  angularConfig,
};
