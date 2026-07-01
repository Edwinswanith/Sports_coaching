/**
 * Test runner for the web workspace.
 *  - jsdom environment so React Testing Library can render client components
 *  - ts-jest with an inline tsconfig (react-jsx) so it doesn't inherit Next's
 *    JSX-preserve build config
 *  - the pure logic tests (roles / themes) run fine under jsdom too
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          esModuleInterop: true,
          isolatedModules: true,
          skipLibCheck: true,
          jsx: "react-jsx",
        },
      },
    ],
  },
};
