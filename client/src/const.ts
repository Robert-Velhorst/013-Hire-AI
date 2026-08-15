export { COOKIE_NAME } from "@shared/const";

// Login initiation stays same-origin so runtime configuration and state
// signing remain server-owned in every environment.
export const getLoginUrl = () => "/api/oauth/login";
