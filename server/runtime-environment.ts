const appEnvironment = process.env.APP_ENV?.trim().toLowerCase();

export const isDevelopmentDeployment =
  process.env.NODE_ENV !== "production" || appEnvironment === "development";
