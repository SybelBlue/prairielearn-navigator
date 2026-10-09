//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};

/** @type WebpackConfig */
const cliConfig = {
  name: 'cli',
  target: 'node',
  mode: 'none',

  // Must not import 'vscode' (enforced by eslint): there is no external for it here.
  entry: './src/cli/main.ts',
  output: {
    // Published from packages/cli as @sybelblue/prairielearn-navigator.
    path: path.resolve(__dirname, 'packages/cli/dist'),
    filename: 'cli.cjs',
    libraryTarget: 'commonjs2'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: extensionConfig.module,
  plugins: [
    new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })
  ],
  devtool: false,
};

/** @type WebpackConfig */
const libraryConfig = {
  name: 'library',
  target: 'node22',
  mode: 'production',
  entry: './src/library.ts',
  output: {
    path: path.resolve(__dirname, 'packages/cli/dist'),
    filename: 'index.js',
    library: { type: 'module' },
  },
  experiments: { outputModule: true },
  resolve: cliConfig.resolve,
  module: extensionConfig.module,
  devtool: false,
};

module.exports = [ extensionConfig, cliConfig, libraryConfig ];
