const fs = require('fs');
const content = fs.readFileSync('src/app/services/game-state.service.ts', 'utf-8').split('\n');

// Find startNightPhase
const startIdx = content.findIndex(line => line.includes('startNightPhase() {'));
// Find resetGame
const endIdx = content.findIndex(line => line.includes('resetGame() {'));

if (startIdx >= 0 && endIdx >= 0) {
    const newContent = content.slice(0, startIdx).concat(content.slice(endIdx));
    fs.writeFileSync('src/app/services/game-state.service.ts', newContent.join('\n'));
    console.log('Successfully sliced game-state.service.ts');
} else {
    console.log('Indices not found', startIdx, endIdx);
}
