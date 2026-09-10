const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create({
    instance: { port: 27117, dbName: 'dutylaunch-hrms-test' },
  });
  console.log('MONGO_URI=' + mongod.getUri());
  process.stdin.resume();
})();
