const baseWebpackConfig = require('./webpack.config.js');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');

baseWebpackConfig.mode = 'production';

baseWebpackConfig.plugins.push(
  new UglifyJSPlugin({
    sourceMap: true,
  })
);

module.exports = baseWebpackConfig;
