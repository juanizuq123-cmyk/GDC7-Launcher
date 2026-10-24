'use strict';

// Channel configuration is deliberately independent from update-keys.cjs and every GDC7 URL.
// The private signing key is held outside this source tree in the local-user secret store.
const publicKey = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAov3ymn4RTyrd17Ke5LWtsNs8HIjU1BXG0PqfL5whPpo=\n-----END PUBLIC KEY-----\n";
const packaged = require('./boreal-channel-config.json');

module.exports = Object.freeze({
  eventId: 'estacion-boreal',
  publicKey,
  channelUrl: process.env.ESTACION_BOREAL_PROFILE_CHANNEL_URL || packaged.channelUrl || null,
  constructorChannelUrl: process.env.BOREAL_CONSTRUCTOR_PROFILE_CHANNEL_URL || packaged.constructorChannelUrl || null,
  releaseRepository: process.env.ESTACION_BOREAL_RELEASE_REPOSITORY || packaged.releaseRepository || null
});
