export type ControlEnv = ControlBindings & {
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SIGNING_KEY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  PUBLISH_CALLBACK_SECRET?: string;
};
