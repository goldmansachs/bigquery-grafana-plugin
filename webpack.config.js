const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const ZipPlugin = require('zip-webpack-plugin');

module.exports = {
  context: path.join(__dirname, 'src'),
  entry: {
    module: './module.ts',
  },
  devtool: 'source-map',
  output: {
    filename: '[name].js',
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'amd',
  },
  externals: [
    'lodash',
    function(context, request, callback) {
      var prefix = 'grafana/';
      if (request.indexOf(prefix) === 0) {
        return callback(null, request.substr(prefix.length));
      }
      callback();
    },
  ],
  plugins: [
    new CleanWebpackPlugin({cleanOnceBeforeBuildPatterns: ['bigquery-datasource/'], dangerouslyAllowCleanPatternsOutsideProject: true}),
    new CleanWebpackPlugin({cleanOnceBeforeBuildPatterns: ['bigquery-datasource.zip'], dangerouslyAllowCleanPatternsOutsideProject: true}),
    new CopyWebpackPlugin({
      patterns : [
        { from: 'plugin.json', to: '.' },
        { from: '../README.md', to: '.' },
        { from: '../LICENSE.md', to: '.' },
        { from: 'img/*', to: '.' },
        { from: 'partials/*', to: '.' },
    ]}),
    new ZipPlugin({
      path: '',
      filename: 'bigquery-datasource'
    })
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.js'],
    fallback: {
      fs: false
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'babel-loader',
            options: { presets: ['env'] },
          },
          'ts-loader',
        ],
        exclude: /(node_modules)/,
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
};
