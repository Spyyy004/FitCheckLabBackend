// mixpanel.js
import mixpanelLib from 'mixpanel';

const mixpanel = mixpanelLib.init(process.env.MIXPANEL_TOKEN, {
  protocol: 'https',
});

/**
 * Add a user to Mixpanel people profile
 */
export const addUserToMixpanel = (userId, userProps = {}) => {
  if (!userId) return;
  mixpanel.people.set(userId, userProps);
};

/**
 * Track an event in Mixpanel
 */
export const trackEvent = (userId, eventName, properties = {}) => {
  if (!userId || !eventName) return;
  mixpanel.track(eventName, {
    distinct_id: userId,
    ...properties,
  });
};
