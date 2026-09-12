-- A series' description was written and never read.
--
-- It was editable on the series form, stored on TestSeries, and carried all the way into the
-- student catalog payload -- where no screen in either portal ever rendered it. Nobody outside
-- the admin who typed it has ever seen one, so there is nothing to migrate it into: the column
-- goes, and with it the field on the form and the key in the catalog every student downloads.

ALTER TABLE "TestSeries" DROP COLUMN "description";
