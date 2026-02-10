
interface GuestNameModalProps {
    userId: string;
    onSubmit: (name: string) => void;
}

function GuestNameModal({ userId, onSubmit }: GuestNameModalProps) {
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setSubmitting(true);
        try {
            const { error } = await getSupabaseBrowserClient()
                .from("profiles")
                .upsert({ id: userId, display_name: name.trim() }, { onConflict: "id" });

            if (error) throw error;
            onSubmit(name.trim());
        } catch (err) {
            console.error("Failed to save name", err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-xl bg-[#1a1a1f] border border-white/10 p-6 shadow-2xl">
                <h2 className="text-xl font-bold text-white mb-2">Welcome!</h2>
                <p className="text-white/60 mb-6 text-sm">
                    Please enter your name to join the study room.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-white/40 uppercase mb-1">
                            Display Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-lg bg-black/50 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:border-purple-500 focus:outline-none"
                            placeholder="e.g. Alex Smith"
                            autoFocus
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!name.trim() || submitting}
                        className="w-full rounded-lg bg-purple-600 py-3 font-bold text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? "Joining..." : "Join Room"}
                    </button>
                </form>
            </div>
        </div>
    );
}
