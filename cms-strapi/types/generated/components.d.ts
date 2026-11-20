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

export interface GamePropertyLevel extends Struct.ComponentSchema {
  collectionName: 'components_game_property_levels';
  info: {
    description: 'Um n\u00EDvel do tipo de im\u00F3vel (1\u20133): renda m\u00E1xima por dia e custo para subir a ele';
    displayName: 'N\u00EDvel do im\u00F3vel';
    icon: 'layer';
  };
  attributes: {
    level: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 3;
          min: 1;
        },
        number
      >;
    maxIncome: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    upgradeCost: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'game.job-task': GameJobTask;
      'game.property-level': GamePropertyLevel;
    }
  }
}
