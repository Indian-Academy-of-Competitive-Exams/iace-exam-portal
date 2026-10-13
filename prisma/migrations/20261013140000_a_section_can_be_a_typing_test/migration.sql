-- A section of a paper can be a typing test: SSC CGL Tier 2 ends in a data-entry module, and an
-- RRB typing test is a paper of one such section.
--
-- typingPreset names the standard the section is held to. It is a TYPING_PRESETS key in
-- @iace/contracts: the standards are code-owned, so this is text and no enum has to be migrated
-- when a board changes one. A section carrying it holds one TYPING question worth no marks, on a
-- clock of exactly the standard's length — rules the API states, since they span the section, its
-- session and the paper.
--
-- Null on every existing section, which is every ordinary one. No row is moved. The guard that
-- freezes a locked configuration's sections refuses any write to them, so it covers this column.

-- AlterTable
ALTER TABLE "BaseConfigSection" ADD COLUMN     "typingPreset" TEXT;

