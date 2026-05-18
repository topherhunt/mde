import type { Configuration } from 'webpack';

import { plugins } from './webpack.plugins';

const rendererRules = [
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
  {
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
  },
  {
    test: /\.m?js$/,
    resolve: {
      fullySpecified: false,
    },
  },
];

export const rendererConfig: Configuration = {
  target: 'web',
  module: {
    rules: rendererRules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    conditionNames: ['import', 'module', 'require', 'default'],
  },
};
