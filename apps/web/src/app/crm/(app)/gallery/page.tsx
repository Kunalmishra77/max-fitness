import { getTranslations } from 'next-intl/server';
import { can, mayAfterPinEntry } from '@mfp/core';
import { PrismaGallery } from '@mfp/db';
import {
  addGalleryPhotoAction,
  deleteGalleryPhotoAction,
  moveGalleryPhotoAction,
  setGalleryPhotoPublishedAction,
  unlockSettingsAction,
} from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { GalleryManager, type GalleryPhotoView } from '@/components/crm/gallery-manager';
import { SettingsUnlock } from '@/components/crm/settings-forms';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * The website's photo gallery (ADR-091).
 *
 * The owner's, behind the PIN: these are the first thing a stranger sees of the gym. The
 * built-in photos stay on the site until the first one here is published, so the gallery is
 * never half the gym's own and half a set from last year.
 */

export const dynamic = 'force-dynamic';

export default async function CrmGalleryPage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const { clock, prisma } = getContainer();
  const now = clock.now();

  if (!mayAfterPinEntry(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('gallery.title')} subtitle={t('menu.gallery.desc')} back="/crm/more" />
        <p role="alert" className="m-4 rounded-panel bg-tint-fee-none-bg p-4 text-crm-body font-semibold text-brand-obsidian">
          {t('gallery.notAllowed')}
        </p>
        <BottomNav active="more" />
      </>
    );
  }

  if (!can(actor, 'settings.manage', now)) {
    return (
      <>
        <CrmHeader title={t('gallery.title')} subtitle={t('menu.gallery.desc')} back="/crm/more" />
        <SettingsUnlock unlock={unlockSettingsAction} />
        <BottomNav active="more" />
      </>
    );
  }

  const photos: GalleryPhotoView[] = (await new PrismaGallery(prisma).all(gym.id)).map((photo) => ({
    id: photo.id,
    isPublished: photo.isPublished,
    captionEn: photo.captionEn,
    captionHi: photo.captionHi,
  }));

  return (
    <>
      <CrmHeader title={t('gallery.title')} subtitle={t('menu.gallery.desc')} back="/crm/more" />
      <div className="p-4 pb-24 lg:p-0">
        <GalleryManager
          photos={photos}
          add={addGalleryPhotoAction}
          remove={deleteGalleryPhotoAction}
          publish={setGalleryPhotoPublishedAction}
          move={moveGalleryPhotoAction}
        />
      </div>
      <BottomNav active="more" />
    </>
  );
}
