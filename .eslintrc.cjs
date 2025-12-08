module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname
  },
  extends: [
    'standard-with-typescript'
  ],
  rules: {
    '@typescript-eslint/semi': ['error', 'always']
  }
};
