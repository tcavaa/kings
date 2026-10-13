import { ArrowRight, Plus, LogOut } from "lucide-react";
import { checkPin } from "../lib/profiles";
import ProfileForm, { ProfilePicker } from "./ProfileForm";
import PinPromptModal from "./PinPromptModal";
import Sheet from "./ui/Sheet";
import AvatarImg from "./AvatarImg";

/**
 * The lobby's profile sheet: pick who plays on this device, create one, or
 * edit one. `p` is the lobby's useProfiles() state; `onClose` hides the sheet
 * (it is also called once a profile is picked or saved).
 */
export default function ProfileSheet({ p, onClose }) {
  const { active, profiles } = p;
  const close = () => {
    p.closeProfileSheet();
    onClose();
  };
  return (
    <Sheet
      title={active ? "შენი სივრცე." : "ყველაფერი შენით იწყება."}
      onClose={close}
    >
      <div className="k-profile-area">
        {p.loading ? (
          <p role="status">პროფილები იტვირთება…</p>
        ) : p.profileError ? (
          <div className="k-empty">
            <p>პროფილების ჩატვირთვა ვერ მოხერხდა.</p>
            <button className="k-button" onClick={p.reload}>
              სცადე ხელახლა <ArrowRight size={16} />
            </button>
          </div>
        ) : p.showForm ? (
          <ProfileForm
            key={p.editing?.id || "new"}
            editing={p.editing}
            currentPin={p.editPin}
            onDone={async (saved) => {
              await p.onProfileSaved(saved);
              onClose();
            }}
            onCancel={profiles.length ? p.cancelForm : null}
          />
        ) : (
          <>
            {active && (
              <div className="k-member">
                <AvatarImg avatar={active.avatar} size={64} />
                <div>
                  <small>PLAYER PROFILE</small>
                  <h3>{active.name}</h3>
                </div>
                <button
                  className="k-icon-button"
                  title="პროფილის გადართვა"
                  onClick={p.switchProfile}
                >
                  <LogOut size={18} />
                </button>
              </div>
            )}
            <ProfilePicker
              profiles={profiles}
              value={p.activeId}
              onChange={p.pickProfile}
              onEdit={p.editProfile}
            />
            <button
              className="k-button k-button-outline"
              onClick={p.startNewProfile}
            >
              ახალი პროფილი <Plus size={18} />
            </button>
          </>
        )}
      </div>
      {p.pinPending && (
        <PinPromptModal
          profile={p.pinPending}
          onSuccess={(result) => {
            p.confirmPin(result);
            onClose();
          }}
          onCancel={p.cancelPin}
          onGone={p.profileGone}
        />
      )}
      {p.editPending && (
        <PinPromptModal
          profile={p.editPending}
          check={checkPin}
          hint="შეიყვანე კოდი პროფილის შესაცვლელად."
          onSuccess={p.confirmEditPin}
          onCancel={p.cancelEditPin}
          onGone={p.profileGone}
        />
      )}
    </Sheet>
  );
}
