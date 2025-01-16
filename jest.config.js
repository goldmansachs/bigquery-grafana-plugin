module.exports = {
  verbose: true,
  roots: ['<rootDir>'],
  transform: {
    '\\.(js|jsx)$': 'babel-jest',
    '\\.(ts|tsx)?$': 'ts-jest',
  },
  testEnvironment: "jsdom",
  testRegex: '(\\.|/)([jt]est)\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  coverageDirectory: './coverage/',
  collectCoverage: true,
  moduleNameMapper: {
    'app/core/utils/datemath': '<rootDir>/node_modules/grafana-sdk-mocks/app/core/utils/datemath.ts',
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/(?!lodash-es).+\\.js$'],
  globals: {
    'ts-jest': {
      tsConfig: {
        strictNullChecks: false,
        noImplicitAny: false,
      },
    },
  },
};
