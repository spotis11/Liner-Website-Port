// Welcome feature: post-sign-in greeting + post-sign-up onboarding wizard.

export { WelcomeGate } from "./ui/WelcomeGate";
export {
  useWelcomeStore,
  createWelcomeStore,
  WELCOME_STORAGE_KEY,
  ONBOARDED_STORAGE_KEY,
  ONBOARDING_STEP_COUNT,
  ONBOARDING_FINALE_STEP,
  MAX_ARTIST_PICKS,
  emptyDraft,
} from "./store/welcomeStore";
export type {
  WelcomeState,
  WelcomeFlow,
  WelcomeKind,
  WelcomeDraft,
} from "./store/welcomeStore";
export {
  POPULAR_ARTIST_NAMES,
  fetchPopularArtistOptions,
} from "./lib/popularArtists";
export type { PopularArtistOption } from "./lib/popularArtists";
