import { Pipe, PipeTransform } from '@angular/core';
import { Player } from '../models/types';

@Pipe({ name: 'playerById', standalone: true })
export class PlayerByIdPipe implements PipeTransform {
  transform(players: Player[], id: string): Player | undefined {
    return players.find(p => p.id === id);
  }
}
