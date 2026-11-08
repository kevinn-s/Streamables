import { create } from 'zustand';
import { BrowserWindow, Updater } from "electrobun/main";
import { useRef, useState, useEffect, useCallback } from 'react';
import TubeView from './TubeView';
import main from "../../mods/main.bundle.js?raw";
import "electrobun/view"; // Registers the custom element
import type { WebviewTagElement } from "electrobun/view";
import { useSettingsStore } from '../../states/settings';
import { Player } from './Player';
import { useNavigate,
       useNavigateStore,} from '../../lib/hooks/useNavigate';

interface Store {
    url: string;
    pageUrl: string;
    watchId: string;
    watchUrl: string;

};

export const useValue = create<Store>()(() => ({
    url: '',
    pageUrl: '',
    watchId: '',
    watchUrl: '',
}));


export const Main: React.FC = () => {
    const watchId = useValue((state) => state.watchId), watchUrl = useValue((state) => state.watchUrl);

    const {navigate, out, register, back} = useNavigate();

 useEffect(() => {
    register({
        pattern: "Tubeview",
        component: (p: Record<string, string>) => {
            return (
                <TubeView
                    src={p.url ?? "https://www.youtube.com"}
                    navigate={navigate}
                />
            );
        },
    });

    register({
        pattern: "Player",
        component: (p: Record<string, string>) => (
            <Player
                watchId={p.watchId ?? ""}
                watchUrl={p.watchUrl ?? ""}
            />
        ),
    });
}, [register, navigate]);
 

    useEffect(() => {
        if (useNavigateStore.getState().index === -1) {
            navigate({ to: "Tubeview" });
        }
        }, [navigate]);
    
    useEffect(() => {
        if (!watchId.trim() || !watchUrl.trim()) return;

        navigate({ to: "Player", params: {"watchId" : watchId, "watchUrl": watchUrl} });
        }, [watchId, watchUrl, navigate]);

    return (
        <div>
            <div>
                <button onClick={back}>Back</button>
            </div>
            <div>
                {out}
            </div>
        </div>

    );
};