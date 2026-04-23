import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./components/lobby/lobby.component').then(m => m.LobbyComponent) },
  { path: 'game', loadComponent: () => import('./components/game-board/game-board.component').then(m => m.GameBoardComponent) },
  { path: 'end', loadComponent: () => import('./components/winner/winner.component').then(m => m.WinnerComponent) },
  { path: '**', redirectTo: '' },
];
