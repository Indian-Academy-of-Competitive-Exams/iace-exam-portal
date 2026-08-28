import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import { noHotPathDbWrite } from '../eslint-rules/no-hot-path-db-write.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

const service = (body) => `class AttemptStateService { async save() { ${body} } }`;

ruleTester.run('no-hot-path-db-write', noHotPathDbWrite, {
  valid: [
    // Redis is the whole point of the path.
    service('await this.redis.setJson(key, state, ttl);'),
    service('await this.redis.client.sadd(dirty, attemptId);'),
    service('return this.state.save(studentId, id, body);'),

    // A READ is how the path checks the attempt is this student's and still open.
    service('const a = await this.prisma.attempt.findUnique({ where: { id } }); return a;'),
    service('await this.prisma.attempt.findFirst({ where: { id } });'),

    // The same method name on something that is not Prisma.
    service('this.cache.update(next);'),
    service('rows.map((r) => r.update);'),
  ],

  invalid: [
    {
      code: service('await this.prisma.attemptQuestion.updateMany({ where: {}, data: {} });'),
      errors: [{ messageId: 'hotPathWrite' }],
    },
    {
      code: service('await this.prisma.attempt.update({ where: { id }, data: {} });'),
      errors: [{ messageId: 'hotPathWrite' }],
    },
    {
      code: service('await prisma.attemptQuestion.createMany({ data: rows });'),
      errors: [{ messageId: 'hotPathWrite' }],
    },
    {
      // A transaction is a write path however it is spelled inside.
      code: service('await this.prisma.$transaction([]);'),
      errors: [{ messageId: 'hotPathWrite' }],
    },
    {
      code: service('await this.prisma.$executeRaw`UPDATE "Attempt" SET x = 1`;'),
      errors: [{ messageId: 'hotPathWrite' }],
    },
  ],
});
