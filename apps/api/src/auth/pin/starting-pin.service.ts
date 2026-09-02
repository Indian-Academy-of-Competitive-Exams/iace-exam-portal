/**
 * The PIN the institute issues, as opposed to the one a student chooses. Both
 * paths that hand one out — the roster import and an admin adding a student by
 * hand — mint it here, so neither can quietly go back to a guessable one.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActorTypes } from '@iace/contracts';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MESSAGE_SENDER,
  type MessageSender,
} from '../../common/messaging';
import { PinService } from './pin.service';
import { randomPin } from './random-pin';

/** argon2 is memory-hard by design: a thousand hashes at once would ask for ~19GB. */
const HASH_CONCURRENCY = 4;

/** A PIN and its hash, together only for as long as it takes to write one and text the other. */
export interface StartingPin {
  mobile: string;
  pin: string;
  hash: string;
}

@Injectable()
export class StartingPinService {
  private readonly logger = new Logger(StartingPinService.name);

  constructor(
    private readonly pin: PinService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  /** Hashed up front and in batches, so a 5,000-row roster is not 5,000 serial argon2 calls. */
  async mint(mobiles: readonly string[]): Promise<StartingPin[]> {
    const minted: StartingPin[] = [];

    for (let start = 0; start < mobiles.length; start += HASH_CONCURRENCY) {
      const batch = mobiles
        .slice(start, start + HASH_CONCURRENCY)
        .map((mobile) => ({ mobile, pin: randomPin() }));
      const hashes = await Promise.all(batch.map(({ pin }) => this.pin.hash(pin)));
      batch.forEach((issued, index) => minted.push({ ...issued, hash: hashes[index]! }));
    }

    return minted;
  }

  /** The one time a PIN is readable. Called once the rows are durable, and unable to fail them. */
  async announce(issued: readonly StartingPin[]): Promise<void> {
    for (const { mobile, pin } of issued) {
      await this.sender
        .send({
          channel: MESSAGE_CHANNELS.SMS,
          kind: MESSAGE_KINDS.PIN,
          to: mobile,
          actor: ActorTypes.STUDENT,
          body: `${pin} is your IACE PIN. Sign in with your mobile number and change it.`,
          data: { pin },
        })
        .catch((error: unknown) => {
          this.logger.error(`Starting PIN not delivered to ${mobile}`, error);
        });
    }
  }
}
