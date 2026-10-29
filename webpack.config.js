//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/** @typedef {import('webpack').Configuration} WebpackConfig */

/**
 * Keep ES modules intact until webpack sees them. The regular tsconfig keeps
 * its Node16 settings for type-checking and test compilation.
 */
const typescript = {
  rules: [
    {
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [
        {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.webpack.json'),
          },
        },
      ],
    },
  ],
};

const resolve = {
  extensions: ['.ts', '.js'],
};

/** @type WebpackConfig */
const extensionConfig = {
  name: 'extension',
  target: 'node',
  // Development builds stay readable; package.json selects production mode
  // for Marketplace artifacts.
  mode: 'none',
  entry: {
    extension: './src/extension.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    chunkFilename: '[name].js',
    libraryTarget: 'commonjs2',
    clean: true,
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve,
  module: typescript,
  // VS Marketplace warns about any single large file. Node loads this chunk
  // synchronously during activation, so splitting dependencies adds no async
  // boundary while keeping both files below the warning threshold.
  optimization: {
    splitChunks: {
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          enforce: true,
        },
      },
    },
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type WebpackConfig */
const npmConfig = {
  name: 'npm',
  target: 'node22',
  mode: 'none',
  // Build both public entry points together so their headless core and
  // dependencies are emitted once in shared.js.
  entry: {
    cli: './src/cli/main.ts',
    index: './src/library.ts',
  },
  output: {
    path: path.resolve(__dirname, 'packages/cli/dist'),
    filename: '[name].js',
    chunkFilename: '[name].js',
    library: { type: 'module' },
    clean: true,
  },
  experiments: { outputModule: true },
  resolve,
  module: typescript,
  plugins: [
    new webpack.BannerPlugin({
      banner: '#!/usr/bin/env node',
      raw: true,
      include: /cli\.js$/,
    }),
  ],
  optimization: {
    splitChunks: {
      chunks: 'all',
      minSize: 0,
      minChunks: 2,
      name: 'shared',
    },
  },
  // npm artifacts must never inherit the extension's source-map setting.
  devtool: false,
};

module.exports = [extensionConfig, npmConfig];
