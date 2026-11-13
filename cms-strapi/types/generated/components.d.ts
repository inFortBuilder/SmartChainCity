import type { Schema, Struct } from '@strapi/strapi';

export interface GameJobTask extends Struct.ComponentSchema {
  collectionName: 'components_game_job_tasks';
  info: {
    description: 'Uma tarefa do minigame da profiss\u00E3o (GDD, cap\u00EDtulo 4)';
    displayName: 'Tarefa';
    icon: 'check';
  };
  attributes: {
    energy: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    happiness: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    minutes: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    tokens: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'game.job-task': GameJobTask;
    }
  }
}
