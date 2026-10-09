function later(message) {
  const err = new Error(message);
  err.code = 'PHASE_SHELL';
  return err;
}

async function createShipment() {
  throw later('Delhivery booking starts in Phase 5');
}

async function trackShipment() {
  throw later('Delhivery tracking starts in Phase 6');
}

module.exports = {
  name: 'delhivery',
  createShipment,
  trackShipment,
};
